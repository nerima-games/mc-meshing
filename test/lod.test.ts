/**
 * LOD simplification.
 *
 * The port's contract, in the order it matters: the level vocabulary, the key
 * encoding, purity, what the snapping does to a quad, what it does to a COUNT,
 * and what it leaves alone. The last group is the one that protects the rest of
 * the repository — simplification must not disturb the canonical face order or
 * the layer routing, both of which golden hashes and mc-render depend on.
 *
 * Regression names (docs/design-notes.md):
 *   lod-zero-is-identity
 *   lod-simplify-is-pure
 *   lod-preserves-silhouette
 *   lod-never-opens-a-hole
 *   lod-preserves-emission-order
 *   lod-reduction-is-anisotropic
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck, Schema } from 'effect'
import { AO_NONE } from '../src/domain/ambient-occlusion'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, CHUNK_SIZE, type ChunkView, blockIndex, emptyChunk } from '../src/domain/chunk-view'
import { FACES, FACE_DIRECTIONS, type FaceDirection, faceOf, tangentAxes } from '../src/domain/faces'
import { LOD_LEVELS, type LodLevel, LodLevelSchema, STEP_FOR_LOD, packQuadKey, simplifyMesh } from '../src/domain/lod'
import {
  type MeshLayers,
  type Quad,
  meshChunk,
  meshChunkNaive,
  totalQuadArea,
  totalQuadCount,
} from '../src/domain/mesh'
import { EMPTY_MESH_CONFIG, type MeshConfig } from '../src/domain/opacity'

const STONE = 1
const GRASS = 2
const WATER = 3
const GLASS = 4

const CONFIG: MeshConfig = {
  transparentSolidBlockIds: new Set([GLASS]),
  waterBlockIds: new Set([WATER]),
}

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz)] = blockId
  }
  return { blocks }
}

/** A solid `side` x `side` x 1 slab of stone at y=64, anchored at the origin. */
const slab = (side: number): ChunkView => {
  const cells: Array<readonly [number, number, number, number]> = []
  for (let lx = 0; lx < side; lx += 1) {
    for (let lz = 0; lz < side; lz += 1) {
      cells.push([lx, 64, lz, STONE])
    }
  }
  return chunkWith(cells)
}

const positionOf = (quad: Quad): string => `${quad.lx},${quad.y},${quad.lz}`

const inDirection = (layers: MeshLayers, direction: FaceDirection): ReadonlyArray<Quad> =>
  layers.opaque.filter((quad) => quad.direction === direction)

/** `[min, max]` of a quad on each axis, in cell coordinates. */
const boxOf = (quad: Quad): Readonly<Record<'x' | 'y' | 'z', readonly [number, number]>> => {
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const span = (axis: 'x' | 'y' | 'z'): readonly [number, number] => {
    const origin = axis === 'x' ? quad.lx : axis === 'y' ? quad.y : quad.lz
    const length = axis === widthAxis ? quad.width : axis === heightAxis ? quad.height : 0
    return [origin, origin + length]
  }
  return { x: span('x'), y: span('y'), z: span('z') }
}

/**
 * Chunks of a few scattered blocks. Y is kept modest so that a failing run
 * shrinks to something a human can read, and the block ids span all three
 * layers so that a routing mistake inside simplification is reachable.
 */
const arbitraryChunk = FastCheck.array(
  FastCheck.tuple(
    FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
    FastCheck.integer({ max: 24, min: 0 }),
    FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
    FastCheck.constantFrom(STONE, GRASS, WATER, GLASS),
  ),
  { maxLength: 24, minLength: 1 },
).map((cells) => chunkWith(cells))

const arbitraryLevel: FastCheck.Arbitrary<LodLevel> = FastCheck.constantFrom(...LOD_LEVELS)

describe('the LOD level vocabulary', () => {
  it.effect('is exactly three levels, coarsest last', () =>
    Effect.sync(() => {
      expect(LOD_LEVELS).toStrictEqual([0, 1, 2])
    }),
  )

  it.effect('LodLevelSchema accepts every declared level and nothing else', () =>
    Effect.sync(() => {
      // The schema exists for values that crossed `postMessage` and are
      // `unknown` on arrival. Derived from LOD_LEVELS by spread, so this test is
      // What catches a fourth level being added to one and not the other.
      const isLevel = Schema.is(LodLevelSchema)
      for (const level of LOD_LEVELS) {
        expect(isLevel(level)).toBe(true)
      }
      // A genuinely absent property, not a spelled-out `undefined`/`void 0` literal.
      // Exercises the same "missing" value a `postMessage` payload without this field would produce.
      const missing: { level?: unknown } = {}
      for (const notALevel of [-1, 3, 1.5, '1', missing.level, null]) {
        expect(isLevel(notALevel)).toBe(false)
      }
    }),
  )
})

describe('packQuadKey', () => {
  it.effect('is injective across every carry boundary of its encoding', () =>
    Effect.sync(() => {
      // The encoding is variable-base positional and its ENTIRE job is that two
      // Different quads never share a key: a collision drops a quad covering a
      // Different piece of surface, which is a hole. Injectivity rests on each
      // Base being one MORE than its component's maximum, and a base that is
      // One too small aliases only at the carry — `p2z = 16` against
      // `p2y = 1` — which random sampling over a 1.5e11 range essentially never
      // Draws. So this is exhaustive rather than random, over the three values
      // Per component where aliasing can occur at all: the two ends and the
      // First step off zero. 3^9 = 19,683 packings, every one distinct.
      const coordinates = [0, 1, CHUNK_SIZE]
      const heights = [0, 1, CHUNK_HEIGHT]
      const normals = [-1, 0, 1]
      const keys = new Set<number>()
      let packed = 0
      for (const nx of normals) {
        for (const ny of normals) {
          for (const nz of normals) {
            for (const p0x of coordinates) {
              for (const p0y of heights) {
                for (const p0z of coordinates) {
                  for (const p2x of coordinates) {
                    for (const p2y of heights) {
                      for (const p2z of coordinates) {
                        keys.add(packQuadKey(nx, ny, nz, p0x, p0y, p0z, p2x, p2y, p2z))
                        packed += 1
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      expect(packed).toBe(19_683)
      expect(keys.size).toBe(packed)
    }),
  )

  it.effect('stays inside the exact-integer range at its maximum', () =>
    Effect.sync(() => {
      // Every component at its maximum. Past 2^53 the additions stop being
      // Exact and distinct quads start sharing a key silently.
      const maximum = packQuadKey(1, 1, 1, 16, 256, 16, 16, 256, 16)
      expect(maximum).toBe(148_944_920_282)
      expect(maximum).toBeLessThan(Number.MAX_SAFE_INTEGER)
      expect(Number.isSafeInteger(maximum)).toBe(true)
    }),
  )

  it.effect('rounds its arguments, so a float cannot land between two lattice points', () =>
    Effect.sync(() => {
      expect(packQuadKey(1, 0, 0, 3.4, 64.2, 5.5, 4.4, 65.1, 6.5)).toBe(packQuadKey(1, 0, 0, 3, 64, 6, 4, 65, 7))
    }),
  )
})

describe('LOD 0 and the empty cases', () => {
  it.effect('REGRESSION: LOD 0 returns the very same object, not a copy of it', () =>
    Effect.sync(() => {
      // Lod-zero-is-identity. mc-render calls this on every chunk it uploads,
      // And the near ring — the chunks with the most geometry — is all LOD 0.
      // Rebuilding those arrays would make the common case the expensive one.
      const layers = meshChunk(slab(4), {}, CONFIG)
      expect(simplifyMesh(layers, 0)).toBe(layers)
    }),
  )

  it.effect('returns the same object when there is no opaque geometry to simplify', () =>
    Effect.sync(() => {
      const empty = meshChunk(emptyChunk(), {}, CONFIG)
      for (const level of LOD_LEVELS) {
        expect(simplifyMesh(empty, level)).toBe(empty)
      }
      // A water-only chunk has quads, but none of them opaque: still nothing to
      // Do, because only the opaque layer is simplified.
      const waterOnly = meshChunk(chunkWith([[4, 64, 4, WATER]]), {}, CONFIG)
      expect(waterOnly.water.length).toBe(6)
      expect(simplifyMesh(waterOnly, 2)).toBe(waterOnly)
    }),
  )
})

describe('purity', () => {
  it.effect('REGRESSION: is a function of (layers, level) and of nothing else', () =>
    Effect.sync(() => {
      // Lod-simplify-is-pure. No coordinates, no clock, no randomness — which
      // Is the whole reason docs/responsibility.md §3.4 puts this half of the
      // Reference file in mc-meshing and the distance half in mc-render.
      const layers = meshChunk(slab(6), {}, CONFIG)
      const before = layers.opaque.map((quad) => `${quad.direction}:${positionOf(quad)}:${quad.width}x${quad.height}`)

      const first = simplifyMesh(layers, 1)
      const second = simplifyMesh(layers, 1)

      const render = (result: MeshLayers): string =>
        result.opaque.map((quad) => `${quad.direction}:${positionOf(quad)}:${quad.width}x${quad.height}`).join('|')
      expect(render(first)).toBe(render(second))
      // The input is untouched. A simplification that snapped in place would
      // Pass every count test in this file and corrupt the caller's LOD 0 mesh.
      expect(
        layers.opaque.map((quad) => `${quad.direction}:${positionOf(quad)}:${quad.width}x${quad.height}`),
      ).toStrictEqual(before)
    }),
  )

  it.effect('hands the water and transparentSolid layers straight back', () =>
    Effect.sync(() => {
      // The reference only ever passes `meshed.opaque` to simplifyMesh. Here the
      // Three layers travel together, so the rule moved inside the function —
      // And this is what pins it there.
      const layers = meshChunk(
        chunkWith([
          [2, 64, 2, STONE],
          [4, 64, 4, WATER],
          [6, 64, 6, GLASS],
        ]),
        {},
        CONFIG,
      )
      for (const level of LOD_LEVELS) {
        const simplified = simplifyMesh(layers, level)
        expect(simplified.water).toBe(layers.water)
        expect(simplified.transparentSolid).toBe(layers.transparentSolid)
      }
    }),
  )
})

describe('what snapping does to one quad', () => {
  it.effect('REGRESSION: snaps the horizontal extents and never the vertical one', () =>
    Effect.sync(() => {
      // Lod-preserves-silhouette. y=65 is odd on purpose: a rule that snapped Y
      // Would move this face to 64 and the hill it belongs to would visibly
      // Change height the moment the chunk crossed a LOD threshold.
      const layers = simplifyMesh(meshChunk(chunkWith([[8, 65, 8, STONE]]), {}, CONFIG), 1)

      const [top] = inDirection(layers, 'yPos')
      expect(top?.y).toBe(65)
      // A top face spans (x, z): both are snapped, so it grows to a 2x2 cell.
      expect([top?.lx, top?.lz, top?.width, top?.height]).toStrictEqual([8, 8, 2, 2])

      const [side] = inDirection(layers, 'xPos')
      // An x-facing side spans (y, z). Only z is snapped; the vertical extent
      // Stays exactly one block, at exactly y=65.
      expect([side?.y, side?.width]).toStrictEqual([65, 1])
      expect([side?.lz, side?.height]).toStrictEqual([8, 2])
    }),
  )

  it.effect('snaps outward from the grid the block sits on, not from the block', () =>
    Effect.sync(() => {
      // Lx=9 is odd, so its 2-grid cell is [8, 10) and the snapped quad starts
      // BEHIND the block. Snapping the other way (origin, origin+step) would
      // Leave the cell at 9 and two neighbours would never collide, which is
      // The failure mode where LOD "works" but removes almost nothing.
      const layers = simplifyMesh(meshChunk(chunkWith([[9, 64, 9, STONE]]), {}, CONFIG), 2)
      const [top] = inDirection(layers, 'yPos')
      expect([top?.lx, top?.lz, top?.width, top?.height]).toStrictEqual([8, 8, 4, 4])
    }),
  )

  it.effect('snaps a quad that is wider than it is tall on the right axis for its direction', () =>
    Effect.sync(() => {
      // A 1x1 quad cannot tell `width` from `height`, so nothing above this line
      // Would notice the two being transposed. This test was written while every
      // Quad `meshChunk` emitted really was 1x1, to meet greedy merging when it
      // Landed; merging has landed and its output is quads with width != height,
      // And the quads here are still built BY HAND so that the oblong case is
      // Pinned at chosen extents rather than at whatever a fixture happens to
      // Produce.
      //
      // `ao` is 0 here for the same reason every other field is a fixed literal:
      // This is a test of `simplifyMesh`, which carries `ao` through untouched
      // (`snapQuad` spreads the quad) and never reads it.
      const oblong = (overrides: Partial<Quad>): Quad => ({
        ao: AO_NONE,
        blockId: STONE,
        direction: 'xPos',
        height: 5,
        lx: 5,
        lz: 3,
        role: 'side',
        width: 3,
        y: 7,
        ...overrides,
      })

      // An x-facing side spans (y, z): `width` runs along Y and is left alone,
      // `height` runs along Z and is snapped from [3, 8] out to [2, 8].
      const [side] = simplifyMesh({ crossPlants: [], fluids: [], opaque: [oblong({})], transparentSolid: [], water: [] }, 1).opaque
      expect([side?.lx, side?.y, side?.lz]).toStrictEqual([5, 7, 2])
      expect([side?.width, side?.height]).toStrictEqual([3, 6])

      // A top face spans (x, z): both are snapped. [3, 6] -> [2, 6] and
      // [5, 10] -> [4, 10].
      const [top] = simplifyMesh(
        { crossPlants: [], fluids: [], opaque: [oblong({ direction: 'yPos', role: 'top', lx: 3, y: 64, lz: 5, width: 3, height: 5 })], transparentSolid: [], water: [] },
        1,
      ).opaque
      expect([top?.lx, top?.y, top?.lz]).toStrictEqual([2, 64, 4])
      expect([top?.width, top?.height]).toStrictEqual([4, 6])
    }),
  )

  it.effect('keeps opposing faces of one block apart: six faces in, six faces out', () =>
    Effect.sync(() => {
      // The +X and -X faces of a single cell have the SAME box in cell
      // Coordinates and differ only by their normal. Dropping the normal from
      // The key would collapse them and delete three of the six faces of every
      // Isolated block — a block you can see through from one side.
      for (const level of LOD_LEVELS) {
        const layers = simplifyMesh(meshChunk(chunkWith([[8, 64, 8, STONE]]), {}, CONFIG), level)
        expect(layers.opaque.length).toBe(6)
        expect(layers.opaque.map((quad) => quad.direction).sort()).toStrictEqual([...FACE_DIRECTIONS].sort())
      }
    }),
  )

  it.effect('lets the first quad on a cell keep the cell, block id and all', () =>
    Effect.sync(() => {
      // A DELIBERATE, VISIBLE change, carried over from the reference: the key
      // Is the plane and the box, not the block. Two different blocks that snap
      // Onto one cell collapse to whichever the mesher emitted first, so a
      // Distant hillside can shift from grass to stone at a LOD boundary. A key
      // That included blockId would preserve the texture and remove nothing on
      // Exactly the terrain LOD exists for.
      const layers = simplifyMesh(
        meshChunk(
          chunkWith([
            [0, 64, 0, STONE],
            [1, 64, 0, GRASS],
          ]),
          {},
          CONFIG,
        ),
        1,
      )
      const tops = inDirection(layers, 'yPos')
      expect(tops.length).toBe(1)
      expect(tops[0]?.blockId).toBe(STONE)
    }),
  )
})

describe('STEP_FOR_LOD, which mc-render mirrors', () => {
  // Docs/responsibility.md §3.5(a) hands mc-render an apparent-error formula
  // Whose numerator is `step - 1`, and §3.4 hands it the two distance constants
  // That formula justifies. Exporting the table (domain/lod.ts) is what lets it
  // Compute rather than re-spell.
  //
  // THESE TESTS DERIVE THE STEP FROM BEHAVIOUR AND THEN COMPARE IT TO THE TABLE,
  // Never the other way round. A test that read `STEP_FOR_LOD[level]` and
  // Asserted it equals 1, 2, 4 would be the exact shape docs/design-notes.md
  // Records as "a green suite that runs the code and asks nothing": it would
  // Agree with the table whatever the table said, and mc-render's error formula
  // Would be wrong by the ratio of the real step to the published one with no
  // Test anywhere going red.

  it.effect('REGRESSION: the published step IS the cell size the snapping uses', () =>
    Effect.sync(() => {
      for (const level of LOD_LEVELS) {
        // Lx = lz = 9 is not a multiple of 2 or of 4, so the snapped cell's
        // Origin is strictly behind the block for every level above 0 and a
        // Table that were too small could not fake the measured extent.
        const layers = simplifyMesh(meshChunk(chunkWith([[9, 64, 9, STONE]]), {}, CONFIG), level)
        const [top] = inDirection(layers, 'yPos')

        const step = STEP_FOR_LOD[level]
        // A top face spans (x, z) and both are snapped, so the emitted extent on
        // Each axis is one whole cell — which is the cell size, measured.
        expect([top?.width, top?.height]).toStrictEqual([step, step])
        // And the origin is that cell's, floored. Together the two lines say the
        // Grid is `step`-pitched and phase-aligned to 0, which is everything the
        // `step - 1` bound below rests on.
        expect([top?.lx, top?.lz]).toStrictEqual([Math.floor(9 / step) * step, Math.floor(9 / step) * step])
      }
    }),
  )

  it.effect('REGRESSION: no edge moves further than `step - 1`, which is mc-render`s numerator', () =>
    Effect.sync(() => {
      // THE PROPERTY mc-render's formula is a consequence of. Snapping sends an
      // Extent [a, b] to [floor(a/step)*step, ceil(b/step)*step]; each end
      // Therefore moves by at most `step - 1`, and the error a player sees is
      // That displacement projected onto the screen.
      //
      // Stated over ARBITRARY quads rather than a fixture, because the bound has
      // To hold for the merged extents greedy meshing emits — docs/design-notes.md
      // M-9 — and not merely for the 1x1 quads the naive mesher used to produce.
      FastCheck.assert(
        FastCheck.property(
          arbitraryLevel,
          FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
          FastCheck.integer({ max: CHUNK_SIZE, min: 1 }),
          (level, origin, length) => {
            const step = STEP_FOR_LOD[level]
            const snappedMin = Math.floor(origin / step) * step
            const snappedMax = Math.ceil((origin + length) / step) * step
            expect(origin - snappedMin).toBeLessThanOrEqual(step - 1)
            expect(snappedMax - (origin + length)).toBeLessThanOrEqual(step - 1)
          },
        ),
        { numRuns: 500, seed: 0 },
      )
    }),
  )

  it.effect('the `step - 1` bound is TIGHT, so it is not vacuously satisfied', () =>
    Effect.sync(() => {
      // A bound nothing attains is a bound that would still hold if the
      // Mechanism changed underneath it. `origin = step - 1` puts the block one
      // Cell-unit short of the next boundary, which is the worst case, and the
      // Measurement below is taken from an EMITTED quad rather than from the
      // Arithmetic above.
      for (const level of LOD_LEVELS) {
        const step = STEP_FOR_LOD[level]
        const origin = step - 1
        const layers = simplifyMesh(meshChunk(chunkWith([[origin, 64, origin, STONE]]), {}, CONFIG), level)
        const [top] = inDirection(layers, 'yPos')
        expect(origin - (top?.lx ?? origin)).toBe(step - 1)
      }
    }),
  )

  it.effect('is total over the level vocabulary, so a fourth level cannot be half-added', () =>
    Effect.sync(() => {
      // The same guard `LodLevelSchema` gets above. `STEP_FOR_LOD` is typed
      // `Record<LodLevel, number>`, so this is a compile-time fact — but it is
      // The fact a MIRROR can violate at runtime while still type-checking on
      // Its own side, and mc-dev-meta's `check:mirrors` compares by value.
      expect(Object.keys(STEP_FOR_LOD).map(Number).sort()).toStrictEqual([...LOD_LEVELS].sort())
      // Strictly increasing: level 0 is the no-op, and each level above it is
      // Strictly coarser. A table that repeated a step would make one level buy
      // Nothing while still costing a full `simplifyMesh` pass (§3.5(d)).
      const steps = LOD_LEVELS.map((level) => STEP_FOR_LOD[level])
      expect(steps).toStrictEqual([...steps].sort((left, right) => left - right))
      expect(new Set(steps).size).toBe(steps.length)
      expect(STEP_FOR_LOD[0]).toBe(1)
    }),
  )
})

describe('what simplification does to a COUNT', () => {
  it.effect('REGRESSION: reduces top faces by step squared and side faces by step, on an UNMERGED mesh', () =>
    Effect.sync(() => {
      // Lod-reduction-is-anisotropic. THE measurement this port exists to make
      // Legible, stated as an exact count rather than as a timing.
      //
      // A 4x4x1 stone slab: 16 top + 16 bottom + 4 per side. At LOD 1 the top
      // And bottom faces are snapped on BOTH their axes, so each 2x2 group
      // Becomes one quad (16 -> 4); a side face is snapped on one axis only,
      // Because the other one is Y, so its four quads pair up (4 -> 2).
      //
      // 4x on the horizontal, 2x on the vertical. Any claim that "LOD 1 gives
      // ~25% of the geometry" is a claim about a mesh made of top faces.
      //
      // CHANGED WITH THE MERGE: the input is now `meshChunkNaive` where it used
      // To be `meshChunk`. NOT A WEAKENING — the assertions are byte-for-byte
      // The ones that were here before, at the same values, and this has always
      // Been a test of `simplifyMesh` rather than of the mesher. What changed is
      // That `meshChunk` no longer produces the 1x1 input the claim is about, so
      // Naming the naive mesher is now the only way to say what was always
      // Meant. The behaviour of `simplifyMesh` on MERGED input is a different
      // Fact and gets its own test below — a much less flattering one.
      const full = meshChunkNaive(slab(4), {}, CONFIG)
      expect(totalQuadCount(full)).toBe(16 + 16 + 4 * 4)

      const lod1 = simplifyMesh(full, 1)
      expect(inDirection(lod1, 'yPos').length).toBe(4)
      expect(inDirection(lod1, 'yNeg').length).toBe(4)
      for (const direction of ['xPos', 'xNeg', 'zPos', 'zNeg'] as const) {
        expect(inDirection(lod1, direction).length).toBe(2)
      }
      expect(totalQuadCount(lod1)).toBe(4 + 4 + 4 * 2)

      const lod2 = simplifyMesh(full, 2)
      expect(inDirection(lod2, 'yPos').length).toBe(1)
      for (const direction of ['xPos', 'xNeg', 'zPos', 'zNeg'] as const) {
        expect(inDirection(lod2, direction).length).toBe(1)
      }
      expect(totalQuadCount(lod2)).toBe(1 + 1 + 4)
    }),
  )

  it.effect('REGRESSION: removes NOTHING from an already-merged slab, at either level', () =>
    Effect.sync(() => {
      // Lod-reduction-collapses-after-merging. THE FINDING, and it is a
      // Deliberately uncomfortable one to write down.
      //
      // Docs/responsibility.md §3.5(c) predicted it in as many words before the
      // Merge existed: "上の -18.1% / -43.0% は上限であって、実装後の値ではない",
      // And asked for the M-8 table to be retaken once greedy merging landed.
      // This is that retake, at fixture scale.
      //
      // Simplification works by snapping quads onto a coarser grid and dropping
      // The ones that then coincide. A merged mesh has already collapsed each
      // Flat run into a single quad, so there is no second quad left to coincide
      // WITH: the 4x4 top of this slab is one quad whose box is already 4-grid
      // Aligned, and snapping it changes neither its origin nor its extent.
      //
      // Six quads in, six quads out, at LOD 1 and at LOD 2 alike. The mechanism
      // Has not broken — `lod-never-opens-a-hole` and the anisotropy test above
      // Still pass on unmerged input — it has been SUBSUMED. What LOD removed on
      // This shape, merging now removes earlier and better, and it removes it
      // Without the up-to-11px silhouette error §3.5(a) prices.
      //
      // That is a real argument against the LOD 1 tier on this kind of terrain
      // And it belongs to mc-render, not here. docs/design-notes.md M-8 carries
      // The measured version across all four bench shapes.
      const merged = meshChunk(slab(4), {}, CONFIG)
      expect(totalQuadCount(merged)).toBe(6)

      for (const level of [1, 2] as const) {
        const simplified = simplifyMesh(merged, level)
        expect(totalQuadCount(simplified)).toBe(6)
        // Not merely the same count — the same quads. Nothing moved either.
        expect(simplified.opaque.map((quad) => `${quad.direction}:${positionOf(quad)}:${quad.width}x${quad.height}`))
          .toStrictEqual(
            merged.opaque.map((quad) => `${quad.direction}:${positionOf(quad)}:${quad.width}x${quad.height}`),
          )
      }

      // And the surface is identical to the naive mesher's, so the two paths
      // Genuinely describe the same slab and the comparison above is fair.
      expect(totalQuadArea(merged)).toBe(totalQuadArea(meshChunkNaive(slab(4), {}, CONFIG)))
    }),
  )

  it.effect('never grows the mesh, at any level, on any arrangement', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(arbitraryChunk, arbitraryLevel, (chunk, level) => {
          const full = meshChunk(chunk, {}, CONFIG)
          return simplifyMesh(full, level).opaque.length <= full.opaque.length
        }),
        { numRuns: 60 },
      )
    }),
  )

  it.effect('is monotone in the level: LOD 2 is never larger than LOD 1', () =>
    Effect.sync(() => {
      // The 4-grid is a coarsening of the 2-grid, so every pair of quads that
      // Collides at LOD 1 also collides at LOD 2. If this ever fails, the two
      // Steps have stopped nesting and a chunk could gain geometry as the
      // Player walks away from it.
      FastCheck.assert(
        FastCheck.property(arbitraryChunk, (chunk) => {
          const full = meshChunk(chunk, {}, CONFIG)
          const lod1 = simplifyMesh(full, 1).opaque.length
          const lod2 = simplifyMesh(full, 2).opaque.length
          return lod2 <= lod1 && lod1 <= full.opaque.length
        }),
        { numRuns: 60 },
      )
    }),
  )

  it.effect('is idempotent: simplifying an already-simplified mesh changes nothing', () =>
    Effect.sync(() => {
      // A snapped quad is already grid-aligned and already unique, so a second
      // Pass has nothing to snap and nothing to drop. Worth pinning because it
      // Is what lets mc-render re-run a level without tracking whether it did.
      const render = (layers: MeshLayers): string =>
        layers.opaque.map((quad) => `${quad.direction}:${positionOf(quad)}:${quad.width}x${quad.height}`).join('|')
      FastCheck.assert(
        FastCheck.property(arbitraryChunk, arbitraryLevel, (chunk, level) => {
          const once = simplifyMesh(meshChunk(chunk, {}, CONFIG), level)
          return render(simplifyMesh(once, level)) === render(once)
        }),
        { numRuns: 60 },
      )
    }),
  )
})

describe('what simplification must not break', () => {
  it.effect('REGRESSION: covers every face the full mesh covered — no holes', () =>
    Effect.sync(() => {
      // Lod-never-opens-a-hole. Reduction is easy; reduction that keeps the
      // Surface closed is the whole problem. Every quad of the full mesh must
      // Still lie inside some surviving quad of the same direction, because
      // Snapping only ever grows a box and dedup only ever removes a box that
      // Is identical to one that stayed.
      FastCheck.assert(
        FastCheck.property(arbitraryChunk, arbitraryLevel, (chunk, level) => {
          const full = meshChunk(chunk, {}, CONFIG)
          const simplified = simplifyMesh(full, level)
          return full.opaque.every((original) => {
            const box = boxOf(original)
            return simplified.opaque.some((survivor) => {
              if (survivor.direction !== original.direction) {
                return false
              }
              const covering = boxOf(survivor)
              return (['x', 'y', 'z'] as const).every(
                (axis) => covering[axis][0] <= box[axis][0] && covering[axis][1] >= box[axis][1],
              )
            })
          })
        }),
        { numRuns: 40 },
      )
    }),
  )

  it.effect('REGRESSION: leaves the canonical face order and the within-group order intact', () =>
    Effect.sync(() => {
      // Lod-preserves-emission-order. The output is the input filtered, so a
      // Golden hash may be taken over a simplified mesh exactly as over a full
      // One.
      //
      // CHANGED WITH THE MERGE, and rewritten to be INDEPENDENT of the mesher's
      // Order rather than to restate it. The old version hard-coded
      // `lx -> lz -> y` for all six directions and compared against it; that
      // Sequence is now correct only for the two X directions (domain/mesh.ts
      // Explains why merging forces the slice axis outermost), so a literal
      // Update would have meant copying the mesher's new three-way table into a
      // Second place where it could drift.
      //
      // What this test is actually about is that `simplifyMesh` PRESERVES
      // Whatever order it was handed. Stated that way it does not need to know
      // The order at all — and it is stronger for it, because it now holds for
      // Every input rather than for one fixture.
      const scattered: ReadonlyArray<readonly [number, number, number, number]> = [
        [6, 20, 10, STONE],
        [2, 10, 2, STONE],
        [14, 30, 14, STONE],
        [10, 4, 6, STONE],
      ]
      const full = meshChunk(chunkWith(scattered), {}, EMPTY_MESH_CONFIG)
      const layers = simplifyMesh(full, 1)

      // Every block is more than one grid cell from its neighbours, so nothing
      // Merges and nothing dedups: same quads in, same quads out, same order.
      expect(layers.opaque.map(positionOf)).toStrictEqual(full.opaque.map(positionOf))

      const groups: Array<FaceDirection> = []
      for (const quad of layers.opaque) {
        if (groups[groups.length - 1] !== quad.direction) {
          groups.push(quad.direction)
        }
      }
      expect(groups).toStrictEqual([...FACE_DIRECTIONS])
    }),
  )

  it.effect('REGRESSION: the simplified sequence is the meshed sequence with entries removed, never reordered', () =>
    Effect.sync(() => {
      // The general form of the test above, and what actually licenses a golden
      // Hash over a simplified mesh. `simplifyMesh` is a filter; if it ever
      // Became a sort, or grouped its survivors, every count assertion in this
      // File would still pass and mc-render's hashes would stop matching for a
      // Reason nothing here would explain.
      //
      // A subsequence check catches exactly that and nothing else, which is why
      // It is written out rather than approximated by comparing sorted arrays.
      //
      // The identity used is `direction:blockId:y`, and the choice is forced
      // Rather than convenient: those are precisely the fields snapping is
      // Documented to leave alone. `lx`, `lz`, `width` and `height` all move —
      // That is what snapping IS — so a survivor cannot be recognised by them,
      // And Y is never snapped on any face because the silhouette depends on it
      // (`lod-preserves-silhouette`). Matching on anything snapping touches
      // Would make this test fail for the one reason that is correct behaviour.
      const identity = (quad: Quad): string => `${quad.direction}:${quad.blockId}:${quad.y}`
      FastCheck.assert(
        FastCheck.property(arbitraryChunk, arbitraryLevel, (chunk, level) => {
          const meshed = meshChunk(chunk, {}, CONFIG)
          const full = meshed.opaque.map(identity)
          const simplified = simplifyMesh(meshed, level).opaque.map(identity)
          let cursor = 0
          for (const survivor of simplified) {
            while (cursor < full.length && full[cursor] !== survivor) {
              cursor += 1
            }
            if (cursor >= full.length) {
              return false
            }
            cursor += 1
          }
          return true
        }),
        { numRuns: 60 },
      )
    }),
  )

  it.effect('leaves the role a quad carries alone, so the texture still matches the face', () =>
    Effect.sync(() => {
      const layers = simplifyMesh(meshChunk(slab(4), {}, CONFIG), 2)
      const pairs = new Set(layers.opaque.map((quad) => `${quad.direction}:${quad.role}`))
      expect([...pairs].sort()).toStrictEqual([
        'xNeg:side',
        'xPos:side',
        'yNeg:bottom',
        'yPos:top',
        'zNeg:side',
        'zPos:side',
      ])
    }),
  )
})

describe('the quad axis convention', () => {
  it.effect('faceOf returns the entry FACES holds, not a second copy of it', () =>
    Effect.sync(() => {
      // A duplicated normals table is the drift domain/faces.ts warns about:
      // One copy feeds the golden hashes and the other feeds the LOD key, and
      // Nothing notices until a chunk meshes one way and simplifies the other.
      for (const face of FACES) {
        expect(faceOf(face.direction)).toBe(face)
      }
      expect(FACE_DIRECTIONS.map((direction) => faceOf(direction).direction)).toStrictEqual([...FACE_DIRECTIONS])
    }),
  )

  it.effect('tangentAxes names the two axes that are not the normal, in x y z order', () =>
    Effect.sync(() => {
      // `Quad.width` and `Quad.height` mean nothing without this. Stated as a
      // Property of the normal rather than as a table, so it cannot agree with a
      // Wrong table.
      for (const face of FACES) {
        const [first, second] = tangentAxes(face.direction)
        const normalAxis = face.nx !== 0 ? 'x' : face.ny !== 0 ? 'y' : 'z'
        expect([first, second]).not.toContain(normalAxis)
        expect(first < second).toBe(true)
        expect(new Set([first, second, normalAxis]).size).toBe(3)
      }
    }),
  )
})
