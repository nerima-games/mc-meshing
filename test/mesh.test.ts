/**
 * Face-count, face-order and MERGE properties.
 *
 * The greedy merge has landed, and the centre of gravity of this file moved with
 * it. Before, every quad was 1x1 and a quad COUNT was the same number as the
 * surface AREA, so the two were used interchangeably. They are no longer the
 * same number, and each assertion below now has to say which one it means: the
 * count is what merging reduces, the area is what merging must not touch.
 *
 * Regression names (docs/design-notes.md):
 *   meshing-isolated-block-has-six-faces
 *   meshing-shared-faces-are-culled
 *   meshing-face-order-is-canonical
 *   meshing-face-count-upper-bound
 *   meshing-boundary-open-when-neighbour-absent
 *   meshing-result-is-owned-not-aliased
 *   meshing-merge-covers-the-same-surface
 *   meshing-merge-never-crosses-a-block-boundary
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import { BLOCK_IDS } from '@nerima-games/mc-kernel'
import { AO_MAX } from '../src/domain/ambient-occlusion'
import {
  AIR,
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  emptyChunk,
  getBlock,
  getBlockAcrossBoundary,
} from '../src/domain/chunk-view'
import {
  FACES,
  FACE_DIRECTIONS,
  type FaceDirection,
  INDICES_PER_QUAD,
  type QuadAxis,
  VERTICES_PER_QUAD,
  tangentAxes,
} from '../src/domain/faces'
import { type MeshLayers, type Quad, meshChunk, meshChunkNaive, totalQuadArea, totalQuadCount } from '../src/domain/mesh'
import { EMPTY_MESH_CONFIG, MESH_LAYERS, type MeshConfig } from '../src/domain/opacity'
import { TEST_BLOCKS_PER_CHUNK, TEST_HEIGHT, testBlockIndex, testChunk } from './chunk-fixtures'
import { PROPERTY_TIMEOUT_MS } from './property-timeout'

const STONE = 1
const WATER = 2
const GLASS = 3
if (BLOCK_IDS.length === 0) {
  throw new Error('mc-kernel block registry must contain at least one block')
}
const HIGHEST_REGISTERED_BLOCK_ID = BLOCK_IDS.at(-1)!

/**
 * Every unit block-face a quad covers, as `direction:lx,y,lz:blockId:ao` strings.
 *
 * THE TRANSLATION THE WHOLE FILE RESTS ON. A merged quad is a claim about a
 * rectangle of cells; expanding it back into the cells it claims is what lets a
 * merged mesh be compared, face for face, against an unmerged one. It walks the
 * two axes `tangentAxes` names — the same convention `domain/faces.ts` fixes and
 * `domain/lod.ts` reads — so a merge that wrote a width where a height belongs
 * expands into the wrong cells and every property below notices.
 *
 * `ao` JOINED THE STRING WHEN AO LANDED, and that is a strengthening, not a
 * change of subject. A merged quad carries ONE ambient-occlusion value for its
 * whole rectangle, so writing it onto every unit face the quad covers is a claim
 * that every one of those cells really has that value — and comparing the result
 * against `meshChunkNaive`, which computes AO per cell with no merging at all,
 * is what checks the claim. Without it the coverage property would pin the
 * merge's geometry and say nothing about its shading, which is precisely the
 * half of the merge that AO changed.
 */
const unitFacesOf = (quad: Quad): ReadonlyArray<string> => {
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const at = (axis: QuadAxis, alongWidth: number, alongHeight: number): number => {
    const origin = axis === 'x' ? quad.lx : axis === 'y' ? quad.y : quad.lz
    return origin + (axis === widthAxis ? alongWidth : axis === heightAxis ? alongHeight : 0)
  }
  const faces: Array<string> = []
  for (let alongWidth = 0; alongWidth < quad.width; alongWidth += 1) {
    for (let alongHeight = 0; alongHeight < quad.height; alongHeight += 1) {
      faces.push(
        `${quad.direction}:${at('x', alongWidth, alongHeight)},` +
          `${at('y', alongWidth, alongHeight)},${at('z', alongWidth, alongHeight)}:${quad.blockId}:${quad.ao}`,
      )
    }
  }
  return faces
}

/** Every unit face of every quad in every layer, in emission order. */
const allUnitFaces = (layers: MeshLayers): ReadonlyArray<string> =>
  MESH_LAYERS.flatMap((layer) => layers[layer].flatMap(unitFacesOf))

/** Every quad the mesher produced, across all three layers. */
const everyQuad = (layers: MeshLayers): ReadonlyArray<Quad> => [
  ...layers.opaque,
  ...layers.water,
  ...layers.transparentSolid,
]

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[testBlockIndex(lx, y, lz)] = blockId
  }
  return testChunk(blocks)
}

const CONFIG: MeshConfig = {
  transparentSolidBlockIds: new Set([GLASS]),
  waterBlockIds: new Set([WATER]),
}

const positionOf = (quad: Quad): string => `${quad.lx},${quad.y},${quad.lz}`

/**
 * Six ISOLATED blocks — no two face-adjacent, so nothing merges and each of the
 * six directions holds exactly six 1x1 quads. Order is then the only thing under
 * test, which is what this fixture is for.
 *
 * REBUILT FOR THE MERGE. The old fixture was five blocks pairwise out of step on
 * all three axes, chosen so that sorting by (lx, lz, y) differed from sorting by
 * any other permutation. That was enough while all six directions shared one
 * order. They no longer do — the merge makes the slice axis outermost, so each
 * face family has its own — and pinning three different orders needs a fixture
 * where every key of every one of them actually decides something.
 *
 * The old fixture could not do that: its five blocks had five DISTINCT values on
 * each axis, so the leading key always settled the sequence on its own and the
 * second and third keys were never consulted. It would have accepted
 * `y -> lz -> lx` as readily as the declared `y -> lx -> lz`.
 *
 * So there are ties here on purpose: three blocks share y=10, two share
 * (lx=2, lz=2), two share lx=2, two share lz=2, two share lz=6. Every one of the
 * nine key positions below breaks at least one tie.
 */
const SCATTERED: ReadonlyArray<readonly [number, number, number, number]> = [
  [2, 10, 2, STONE],
  [2, 10, 6, STONE],
  [6, 10, 2, STONE],
  [6, 4, 6, STONE],
  [10, 16, 10, STONE],
  [2, 20, 2, STONE],
]

type CellAxis = 'lx' | 'y' | 'lz'

const axisOf = (cell: readonly [number, number, number, number], axis: CellAxis): number =>
  axis === 'lx' ? cell[0] : axis === 'y' ? cell[1] : cell[2]

/** `SCATTERED` as `lx,y,lz` strings, ordered by the three given keys. */
const scatteredSortedBy = (first: CellAxis, second: CellAxis, third: CellAxis): ReadonlyArray<string> =>
  [...SCATTERED]
    .sort(
      (left, right) =>
        axisOf(left, first) - axisOf(right, first) ||
        axisOf(left, second) - axisOf(right, second) ||
        axisOf(left, third) - axisOf(right, third),
    )
    .map(([lx, y, lz]) => `${lx},${y},${lz}`)

describe('face count', () => {
  it.effect('an empty chunk produces no faces at all', () =>
    Effect.sync(() => {
      const layers = meshChunk(emptyChunk(TEST_HEIGHT), {}, EMPTY_MESH_CONFIG)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )

  it.effect('a single block surrounded by air produces exactly six faces, one per direction', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[8, 64, 8, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(layers.opaque.map((quad) => quad.direction).sort()).toStrictEqual([...FACE_DIRECTIONS].sort())
    }),
  )

  it.effect('two adjacent blocks cover ten block-faces, not twelve: the shared face is culled from both sides', () =>
    Effect.sync(() => {
      // This is THE invariant of face culling. 12 means neither side was
      // Culled; 11 means only one was, which is the asymmetry bug that shows up
      // As a one-sided invisible wall.
      //
      // CHANGED WITH THE MERGE, and not weakened: this used to read
      // `totalQuadCount(...) === 10`, which was the same number only because
      // Every quad was 1x1. The quantity the culling rule is about has always
      // Been the covered AREA — ten block-faces of surface — and that is what is
      // Asserted now, at the same value. The merged COUNT is pinned alongside it
      // At 6, which the old assertion could not have said at all: the two blocks
      // Share four L-shaped pairs of coplanar faces and each pair merges.
      for (const face of FACES) {
        const first: readonly [number, number, number, number] = [8, 64, 8, STONE]
        const second: readonly [number, number, number, number] = [
          8 + face.nx,
          64 + face.ny,
          8 + face.nz,
          STONE,
        ]
        const layers = meshChunk(chunkWith([first, second]), {}, EMPTY_MESH_CONFIG)
        expect(totalQuadArea(layers)).toBe(10)
        expect(totalQuadCount(layers)).toBe(6)
        // The naive mesher still emits one quad per face, so the area it covers
        // Is also its count — and it agrees. That agreement is the whole reason
        // The oracle is worth keeping.
        const naive = meshChunkNaive(chunkWith([first, second]), {}, EMPTY_MESH_CONFIG)
        expect(totalQuadCount(naive)).toBe(10)
        expect(totalQuadArea(naive)).toBe(10)
      }
    }),
  )

  it.effect('an N x N flat layer of stone covers a predictable area, and merges to exactly six quads', () =>
    Effect.sync(() => {
      // A single flat layer of side N: N*N top faces, N*N bottom faces, and
      // 4*N side faces around the rim.
      //
      // CHANGED WITH THE MERGE, and strictly stronger than before. The old
      // Assertion was `totalQuadCount === 2*N*N + 4*N` and its own comment said
      // "a correct greedy merge must cover the same surface with fewer quads,
      // Never with different coverage" — so it was already written as a claim
      // About coverage that happened to be spelled as a count. It is now spelled
      // As coverage, at the identical value, PLUS the merged count, which is the
      // Part that was previously unsayable.
      //
      // Six is exact and worth pinning: the top merges to one quad, the bottom
      // To one, and each of the four rims is a 1xN strip of coplanar faces that
      // Merges to one. It is six for EVERY N, which is the clearest statement
      // This file makes of what merging is for.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ max: CHUNK_SIZE, min: 1 }), (side) => {
          const cells: Array<readonly [number, number, number, number]> = []
          for (let lx = 0; lx < side; lx += 1) {
            for (let lz = 0; lz < side; lz += 1) {
              cells.push([lx, 64, lz, STONE])
            }
          }
          const layers = meshChunk(chunkWith(cells), {}, EMPTY_MESH_CONFIG)
          const naive = meshChunkNaive(chunkWith(cells), {}, EMPTY_MESH_CONFIG)
          const mergedQuadCount = totalQuadCount(layers)
          const naiveQuadCount = totalQuadCount(naive)
          return (
            totalQuadArea(layers) === 2 * side * side + 4 * side &&
            mergedQuadCount === 6 &&
            (side === 1 ||
              (mergedQuadCount * VERTICES_PER_QUAD < naiveQuadCount * VERTICES_PER_QUAD &&
                mergedQuadCount * INDICES_PER_QUAD < naiveQuadCount * INDICES_PER_QUAD))
          )
        }),
        { numRuns: 16 },
      )
    }),
  )

  it.effect('face count never exceeds six per non-air cell, whatever the arrangement', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.array(
            FastCheck.tuple(
              FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
              FastCheck.integer({ max: TEST_HEIGHT - 1, min: 0 }),
              FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
              FastCheck.constantFrom(STONE, WATER, GLASS),
            ),
            { maxLength: 40, minLength: 0 },
          ),
          (cells) => {
            const chunk = chunkWith(cells.map(([lx, y, lz, id]) => [lx, y, lz, id] as const))
            const layers = meshChunk(chunk, {}, CONFIG)
            let solidCells = 0
            for (let index = 0; index < TEST_BLOCKS_PER_CHUNK; index += 1) {
              if (chunk.blocks.get(index) !== AIR) {
                solidCells += 1
              }
            }
            // Stated on the AREA, which is where the six-per-cell bound actually
            // Lives: a cell has six faces however they are grouped into quads.
            // The count is then bounded by the area, because no quad covers less
            // Than one face. Both directions of that chain matter — a merge that
            // Emitted a zero-extent quad would satisfy the old count bound and
            // Break the second half of this one.
            return (
              totalQuadArea(layers) <= solidCells * FACES.length && totalQuadCount(layers) <= totalQuadArea(layers)
            )
          },
        ),
        { numRuns: 100 },
      )
    }),
  )
})

describe('face ordering', () => {
  it.effect('emits faces grouped by direction, in the canonical +X -X +Y -Y +Z -Z order', () =>
    Effect.sync(() => {
      // Golden hashes over geometry buffers are only stable if this order is.
      // See docs/design-notes.md.
      const cells: Array<readonly [number, number, number, number]> = []
      for (let lx = 0; lx < 4; lx += 1) {
        for (let lz = 0; lz < 4; lz += 1) {
          cells.push([lx, 64, lz, STONE])
        }
      }
      const layers = meshChunk(chunkWith(cells), {}, EMPTY_MESH_CONFIG)
      const seen: Array<string> = []
      for (const quad of layers.opaque) {
        if (seen[seen.length - 1] !== quad.direction) {
          seen.push(quad.direction)
        }
      }
      expect(seen).toStrictEqual([...FACE_DIRECTIONS])
    }),
  )

  it.effect('emits, WITHIN one direction, in the order that direction’s slice axis forces', () =>
    Effect.sync(() => {
      // The test above pins the order of the six GROUPS. This one pins the order
      // Inside a group, which domain/mesh.ts declares load-bearing and which
      // Nothing else asserts.
      //
      // CHANGED WITH THE MERGE. It used to assert `lx -> lz -> y` for all six
      // Directions. That is no longer true for four of them, and it could not
      // Be: merging finds maximal rectangles within a plane, so the axis normal
      // To the face has to be the OUTERMOST loop. For +Y/-Y that axis is `y`,
      // Which the old order had innermost. There is no implementation of greedy
      // Meshing that keeps the old sequence, so the assertion had to move.
      //
      // THIS IS NOT A WEAKER ASSERTION. It pins an exact sequence for every one
      // Of the six directions, as before; there are now three sequences instead
      // Of one because the code has three shapes instead of one. What it costs
      // Is real and is recorded in docs/testing.md: a full-buffer golden hash
      // Taken before the merge does not match one taken after.
      const layers = meshChunk(chunkWith(SCATTERED), {}, EMPTY_MESH_CONFIG)
      const emitted = (direction: FaceDirection): ReadonlyArray<string> =>
        layers.opaque.filter((quad) => quad.direction === direction).map(positionOf)

      // Slice axis first, then the two tangent axes in the order the passes
      // Scan them. Spelled out per direction rather than derived, so that an
      // Edit to the passes cannot make this table agree with it.
      const expected: Readonly<Record<FaceDirection, ReadonlyArray<string>>> = {
        xNeg: scatteredSortedBy('lx', 'lz', 'y'),
        xPos: scatteredSortedBy('lx', 'lz', 'y'),
        yNeg: scatteredSortedBy('y', 'lx', 'lz'),
        yPos: scatteredSortedBy('y', 'lx', 'lz'),
        zNeg: scatteredSortedBy('lz', 'lx', 'y'),
        zPos: scatteredSortedBy('lz', 'lx', 'y'),
      }
      for (const direction of FACE_DIRECTIONS) {
        expect(emitted(direction)).toStrictEqual(expected[direction])
      }

      // The fixture has to be able to TELL each declared nesting from its
      // Transpositions, or the assertions above are satisfied by the very bug
      // They exist to catch. Three checks per declared order: swap the first two
      // Keys, swap the last two, and reverse. All nine must differ from their
      // Declared sequence, which is what forces the ties documented on
      // SCATTERED to be there.
      const distinguishes = (first: CellAxis, second: CellAxis, third: CellAxis): void => {
        const declared = scatteredSortedBy(first, second, third)
        expect(declared).not.toStrictEqual(scatteredSortedBy(second, first, third))
        expect(declared).not.toStrictEqual(scatteredSortedBy(first, third, second))
        expect(declared).not.toStrictEqual(scatteredSortedBy(third, second, first))
      }
      distinguishes('lx', 'lz', 'y')
      distinguishes('y', 'lx', 'lz')
      distinguishes('lz', 'lx', 'y')

      // And the three declared orders must differ from EACH OTHER, or a pass
      // That used the wrong family's nesting would still be green.
      expect(scatteredSortedBy('lx', 'lz', 'y')).not.toStrictEqual(scatteredSortedBy('y', 'lx', 'lz'))
      expect(scatteredSortedBy('lx', 'lz', 'y')).not.toStrictEqual(scatteredSortedBy('lz', 'lx', 'y'))
      expect(scatteredSortedBy('y', 'lx', 'lz')).not.toStrictEqual(scatteredSortedBy('lz', 'lx', 'y'))
    }),
  )

  it.effect('is deterministic: meshing the same chunk twice produces identical quad sequences', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [3, 60, 3, STONE],
        [3, 61, 3, WATER],
        [4, 60, 3, GLASS],
      ])
      const render = (quads: ReadonlyArray<Quad>): string =>
        quads.map((quad) => `${quad.direction}:${quad.lx},${quad.y},${quad.lz}:${quad.blockId}`).join('|')
      const first = meshChunk(chunk, {}, CONFIG)
      const second = meshChunk(chunk, {}, CONFIG)
      expect(render(first.opaque)).toBe(render(second.opaque))
      expect(render(first.water)).toBe(render(second.water))
      expect(render(first.transparentSolid)).toBe(render(second.transparentSolid))
    }),
  )
})

describe('quad extent and role', () => {
  const MIXED = chunkWith([
    [2, 64, 2, STONE],
    [6, 30, 9, WATER],
    [11, 200, 4, GLASS],
    [0, 0, 0, STONE],
    [CHUNK_SIZE - 1, TEST_HEIGHT - 1, CHUNK_SIZE - 1, STONE],
  ])

  it.effect('an unmerged quad still covers exactly one block, and a merged one covers its whole rectangle', () =>
    Effect.sync(() => {
      // REPLACES `a naive quad covers exactly one block: width and height are
      // Both 1`, which was written to be the thing that failed when merging
      // Landed. IT DID NOT FAIL. Its fixture — MIXED, below — is five ISOLATED
      // Blocks, no two of them face-adjacent, so nothing in it merges and every
      // Quad really is still 1x1. The assertion went on passing while the
      // Sentence it encoded ("a quad covers exactly one block") became false
      // Everywhere else in the repository.
      //
      // That is worth stating plainly, because it is the more dangerous outcome
      // Of the two: a test written as a tripwire that does not trip teaches the
      // Next reader that nothing changed. What it needed was a fixture with two
      // Blocks touching, and it did not have one.
      //
      // So the replacement keeps the isolated case at full strength — merging
      // Must NOT invent extent where there is no neighbour to merge with — and
      // Adds the case the old fixture was missing.
      const isolated = everyQuad(meshChunk(MIXED, {}, CONFIG))
      expect(isolated.length).toBeGreaterThan(0)
      expect(isolated.every((quad) => quad.width === 1 && quad.height === 1)).toBe(true)

      // A 1x4 run of stone along Z. Its two Z-end caps stay 1x1; its top, bottom
      // And two long sides each merge into a single 4-long quad. Extents are
      // Asserted against `tangentAxes`, so a width written where a height
      // Belongs is caught here and not only in the property tests.
      const run = meshChunk(
        chunkWith([
          [8, 64, 4, STONE],
          [8, 64, 5, STONE],
          [8, 64, 6, STONE],
          [8, 64, 7, STONE],
        ]),
        {},
        EMPTY_MESH_CONFIG,
      )
      const only = (direction: FaceDirection): Quad | undefined =>
        run.opaque.filter((quad) => quad.direction === direction)[0]

      // YPos spans (x, z): one cell wide on X, four long on Z.
      expect([only('yPos')?.width, only('yPos')?.height]).toStrictEqual([1, 4])
      expect([only('yNeg')?.width, only('yNeg')?.height]).toStrictEqual([1, 4])
      // XPos spans (y, z): one cell tall on Y, four long on Z.
      expect([only('xPos')?.width, only('xPos')?.height]).toStrictEqual([1, 4])
      expect([only('xNeg')?.width, only('xNeg')?.height]).toStrictEqual([1, 4])
      // ZPos/zNeg are the end caps, normal to the run, so they cannot merge.
      expect([only('zPos')?.width, only('zPos')?.height]).toStrictEqual([1, 1])
      expect([only('zNeg')?.width, only('zNeg')?.height]).toStrictEqual([1, 1])

      expect(totalQuadCount(run)).toBe(6)
      expect(totalQuadArea(run)).toBe(4 * 4 + 2)
    }),
  )

  it.effect('carries the role its direction implies: yPos is top, yNeg is bottom, the rest are sides', () =>
    Effect.sync(() => {
      // `role` picks the texture. A grass block with its top role on the -Y
      // Face is grass-side-up underground and dirt on the surface, which is a
      // Rendering bug with no crash and no failing count anywhere.
      //
      // The expected pairs are spelled out rather than read back out of FACES,
      // So that an edit to the FACES table cannot make this test agree with it.
      const pairs = new Set(everyQuad(meshChunk(MIXED, {}, CONFIG)).map((quad) => `${quad.direction}:${quad.role}`))
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

  it.effect('reports the cell it was emitted for, not the cell across the face', () =>
    Effect.sync(() => {
      // A quad addressed at the NEIGHBOUR's coordinates renders one block away
      // From its block — the whole surface shifted by one in six directions at
      // Once, which reads as a mesh that no longer lines up with the world.
      const layers = meshChunk(chunkWith([[7, 100, 4, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(new Set(layers.opaque.map(positionOf))).toStrictEqual(new Set(['7,100,4']))
    }),
  )
})

describe('layer routing', () => {
  it.effect('routes water to the water layer and glass to the transparentSolid layer, not to opaque', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [1, 64, 1, STONE],
          [3, 64, 3, WATER],
          [5, 64, 5, GLASS],
        ]),
        {},
        CONFIG,
      )
      expect(layers.opaque.every((quad) => quad.blockId === STONE)).toBe(true)
      expect(layers.water.every((quad) => quad.blockId === WATER)).toBe(true)
      expect(layers.transparentSolid.every((quad) => quad.blockId === GLASS)).toBe(true)
      expect(layers.opaque.length).toBe(6)
      expect(layers.water.length).toBe(6)
      expect(layers.transparentSolid.length).toBe(6)
    }),
  )

  it.effect('with an empty config every block is opaque — the sets really are the only source of truth', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[3, 64, 3, WATER]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(layers.water.length).toBe(0)
    }),
  )

  it.effect('transparentSolid beats water when a block id is claimed by both sets', () =>
    Effect.sync(() => {
      // Plan.md §3.3 fixes this priority. Making the classification total means
      // A config mistake degrades an appearance instead of crashing a worker.
      const contested: MeshConfig = {
        transparentSolidBlockIds: new Set([WATER]),
        waterBlockIds: new Set([WATER]),
      }
      const layers = meshChunk(chunkWith([[3, 64, 3, WATER]]), {}, contested)
      expect(layers.transparentSolid.length).toBe(6)
      expect(layers.water.length).toBe(0)
    }),
  )

  it.effect('a solid block behind glass still renders: transparent solids do not occlude', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, STONE],
          [9, 64, 8, GLASS],
        ]),
        {},
        CONFIG,
      )
      // The stone keeps all six faces: glass does not occlude, so you can see
      // The stone through it. That is the whole point of the three-valued model.
      expect(layers.opaque.length).toBe(6)
      // The glass loses exactly one: its inward face is pressed against opaque
      // Stone and can never be seen. Occlusion is asymmetric here, and correctly
      // So — the culling rule is about the NEIGHBOUR's opacity, not the
      // Emitter's. If this ever reads 6, transparent solids have started
      // Treating opaque neighbours as see-through.
      expect(layers.transparentSolid.length).toBe(5)
      expect(layers.transparentSolid.some((quad) => quad.direction === 'xNeg')).toBe(false)
    }),
  )

  it.effect('two adjacent water cells have no surface between them', () =>
    Effect.sync(() => {
      // Without the same-layer cull the interior of a lake is a wall of quads.
      //
      // Ten is the covered AREA and always was. Water stays deliberately
      // Unmerged, so the count is ten too: twelve would mean no interior cull,
      // While any non-unit extent would mean transparent geometry entered the
      // Opaque-only greedy mask.
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
        ]),
        {},
        CONFIG,
      )
      expect(totalQuadArea(layers)).toBe(10)
      expect(layers.water.length).toBe(10)
      expect(layers.water.every((quad) => quad.width === 1 && quad.height === 1)).toBe(true)
      expect(layers.opaque.length).toBe(0)
    }),
  )
})

describe('chunk boundaries', () => {
  it.effect('an absent neighbour reads as air, so the chunk meshes as open rather than as a black wall', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[0, 64, 0, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
    }),
  )

  it.effect('a present neighbour occludes across the boundary, so seams do not double up', () =>
    Effect.sync(() => {
      const neighbourBlocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
      neighbourBlocks[testBlockIndex(CHUNK_SIZE - 1, 64, 0)] = STONE
      const layers = meshChunk(
        chunkWith([[0, 64, 0, STONE]]),
        { xNeg: testChunk(neighbourBlocks) },
        EMPTY_MESH_CONFIG,
      )
      expect(layers.opaque.length).toBe(5)
      expect(layers.opaque.some((quad) => quad.direction === 'xNeg')).toBe(false)
    }),
  )

  /**
   * The four horizontal seams, each with the cell in the neighbour that TOUCHES
   * it and a cell in the same neighbour that does not.
   *
   * The tangent coordinate is 5 rather than 0 on purpose. With 0, an index
   * transposed between `lx` and `lz` still lands on a real cell and the test
   * cannot tell the two apart; with 5, a transposition reads an empty column
   * and the occlusion disappears.
   */
  const SEAMS = [
    {
      cell: [0, 64, 5],
      direction: 'xNeg',
      elsewhere: [0, 64, 5],
      touching: [CHUNK_SIZE - 1, 64, 5],
    },
    {
      cell: [CHUNK_SIZE - 1, 64, 5],
      direction: 'xPos',
      elsewhere: [CHUNK_SIZE - 1, 64, 5],
      touching: [0, 64, 5],
    },
    {
      cell: [5, 64, 0],
      direction: 'zNeg',
      elsewhere: [5, 64, 0],
      touching: [5, 64, CHUNK_SIZE - 1],
    },
    {
      cell: [5, 64, CHUNK_SIZE - 1],
      direction: 'zPos',
      elsewhere: [5, 64, CHUNK_SIZE - 1],
      touching: [5, 64, 0],
    },
  ] as const satisfies ReadonlyArray<{
    readonly direction: FaceDirection
    readonly cell: readonly [number, number, number]
    readonly touching: readonly [number, number, number]
    readonly elsewhere: readonly [number, number, number]
  }>

  it.effect('occludes across ALL FOUR horizontal seams, not only xNeg', () =>
    Effect.sync(() => {
      // Until this test the xPos, zPos and zNeg arms of getBlockAcrossBoundary
      // Were never executed by the suite at all. A transposed or off-by-one
      // Index in any of them produces a seam that renders a wall of duplicate
      // Faces between two loaded chunks — visible, expensive, and invisible to
      // Every count-based test, because the counts are per chunk and each chunk
      // Is individually correct.
      for (const seam of SEAMS) {
        const layers = meshChunk(
          chunkWith([[...seam.cell, STONE]]),
          { [seam.direction]: chunkWith([[...seam.touching, STONE]]) },
          EMPTY_MESH_CONFIG,
        )
        expect(layers.opaque.length).toBe(5)
        expect(layers.opaque.some((quad) => quad.direction === seam.direction)).toBe(false)
      }
    }),
  )

  it.effect('reads the cell that touches the seam, not merely some cell in the neighbour', () =>
    Effect.sync(() => {
      // The companion to the test above, and the one that actually pins the
      // Index. Occlusion across a seam is satisfied by reading ANY solid cell
      // In the neighbouring chunk; only its absence here shows that the mesher
      // Read the one facing column rather than the far side of the neighbour.
      for (const seam of SEAMS) {
        const layers = meshChunk(
          chunkWith([[...seam.cell, STONE]]),
          { [seam.direction]: chunkWith([[...seam.elsewhere, STONE]]) },
          EMPTY_MESH_CONFIG,
        )
        expect(layers.opaque.length).toBe(6)
      }
    }),
  )

  it.effect('consults the neighbour on the side the face points at, and no other', () =>
    Effect.sync(() => {
      // Cross-wiring xNeg to xPos is symmetric enough to survive a test that
      // Supplies all four neighbours at once. Supplying exactly one at a time
      // Is what makes the wiring observable.
      for (const seam of SEAMS) {
        for (const other of SEAMS) {
          const layers = meshChunk(
            chunkWith([[...seam.cell, STONE]]),
            { [other.direction]: chunkWith([[...seam.touching, STONE]]) },
            EMPTY_MESH_CONFIG,
          )
          expect(layers.opaque.length).toBe(other.direction === seam.direction ? 5 : 6)
        }
      }
    }),
  )
})

describe('getBlockAcrossBoundary', () => {
  // One neighbour per side, each holding a single block with a DISTINCT id at
  // A DISTINCT height and tangent offset. Any mix-up — wrong neighbour, wrong
  // Face of the neighbour, transposed tangent — therefore reads an empty cell
  // And returns AIR rather than coincidentally returning the right answer.
  const XNEG = 11
  const XPOS = 12
  const ZNEG = 13
  const ZPOS = 14
  const XNEG_ZNEG = 15
  const XNEG_ZPOS = 16
  const XPOS_ZNEG = 17
  const XPOS_ZPOS = 18

  const NEIGHBOURS: ChunkNeighbours = {
    xNeg: chunkWith([[CHUNK_SIZE - 1, 40, 5, XNEG]]),
    xNegZNeg: chunkWith([[CHUNK_SIZE - 1, 45, CHUNK_SIZE - 1, XNEG_ZNEG]]),
    xNegZPos: chunkWith([[CHUNK_SIZE - 1, 46, 0, XNEG_ZPOS]]),
    xPos: chunkWith([[0, 41, 6, XPOS]]),
    xPosZNeg: chunkWith([[0, 47, CHUNK_SIZE - 1, XPOS_ZNEG]]),
    xPosZPos: chunkWith([[0, 48, 0, XPOS_ZPOS]]),
    zNeg: chunkWith([[7, 42, CHUNK_SIZE - 1, ZNEG]]),
    zPos: chunkWith([[8, 43, 0, ZPOS]]),
  }

  const CHUNK = chunkWith([[9, 44, 9, STONE]])

  it.effect('maps each out-of-range side to the facing column of the right neighbour', () =>
    Effect.sync(() => {
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, -1, 40, 5)).toBe(XNEG)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, CHUNK_SIZE, 41, 6)).toBe(XPOS)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 7, 42, -1)).toBe(ZNEG)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 8, 43, CHUNK_SIZE)).toBe(ZPOS)
    }),
  )

  it.effect('maps each out-of-range corner to the facing cell of the diagonal neighbour', () =>
    Effect.sync(() => {
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, -1, 45, -1)).toBe(XNEG_ZNEG)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, -1, 46, CHUNK_SIZE)).toBe(XNEG_ZPOS)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, CHUNK_SIZE, 47, -1)).toBe(XPOS_ZNEG)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, CHUNK_SIZE, 48, CHUNK_SIZE)).toBe(XPOS_ZPOS)
    }),
  )

  it.effect('carries the tangent coordinate across unchanged, so a seam does not shear', () =>
    Effect.sync(() => {
      // The lz of an x-side read, and the lx of a z-side read, must survive the
      // Hop. If either is dropped or swapped the neighbour is sampled along the
      // Wrong line and the seam is stitched to the wrong column of blocks.
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, -1, 40, 6)).toBe(AIR)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, CHUNK_SIZE, 41, 5)).toBe(AIR)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 8, 42, -1)).toBe(AIR)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 7, 43, CHUNK_SIZE)).toBe(AIR)
    }),
  )

  it.effect('falls through to this chunk whenever the coordinate is in range', () =>
    Effect.sync(() => {
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 9, 44, 9)).toBe(STONE)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 9, 45, 9)).toBe(AIR)
    }),
  )

  it.effect('reads an absent neighbour as air on every side, not just the one that was tested', () =>
    Effect.sync(() => {
      for (const [lx, y, lz] of [
        [-1, 40, 5],
        [CHUNK_SIZE, 41, 6],
        [7, 42, -1],
        [8, 43, CHUNK_SIZE],
        [-1, 45, -1],
        [-1, 46, CHUNK_SIZE],
        [CHUNK_SIZE, 47, -1],
        [CHUNK_SIZE, 48, CHUNK_SIZE],
      ] as const) {
        expect(getBlockAcrossBoundary(CHUNK, {}, lx, y, lz)).toBe(AIR)
      }
    }),
  )
})

describe('result ownership', () => {
  it.effect('REGRESSION: a later call cannot disturb the result of an earlier one', () =>
    Effect.sync(() => {
      // Meshing-result-is-owned-not-aliased. The reference returns zero-copy
      // Subarray VIEWS into one shared accumulator, valid only until the next
      // GreedyMeshChunk call; a caller who keeps a result sees the next chunk's
      // Data appear inside it. This repository returns owned arrays instead,
      // And docs/design-notes.md M-5 says the pooled fast path is still to come.
      //
      // That is precisely why this test exists NOW. Today it cannot fail; the
      // Day someone lands the pool it becomes the thing that stops the change
      // From being invisible, and whoever writes that pool has to come here and
      // Argue with this comment rather than silently invalidate every caller.
      const first = meshChunk(chunkWith([[2, 64, 2, STONE]]), {}, EMPTY_MESH_CONFIG)
      const heldOpaque = first.opaque
      const snapshot = first.opaque.map(positionOf)

      const second = meshChunk(
        chunkWith([
          [9, 12, 9, STONE],
          [9, 13, 9, STONE],
          [4, 70, 4, WATER],
        ]),
        {},
        CONFIG,
      )

      expect(first.opaque).toBe(heldOpaque)
      expect(first.opaque).not.toBe(second.opaque)
      expect(first.opaque.map(positionOf)).toStrictEqual(snapshot)
      expect(first.opaque.length).toBe(6)
      // The second result is the one that is actually different, so a pool that
      // Merely copied the first result forward would not pass either.
      //
      // CHANGED WITH THE MERGE: the two stacked stone cells merge, so this is
      // Six quads over ten block-faces where it used to be ten over ten. The
      // Aliasing question this test exists for is untouched by that, and the
      // Area is asserted alongside so the fixture is still doing the work of
      // Being visibly DIFFERENT from `first` rather than merely the same size.
      expect(second.opaque.length).toBe(6)
      expect(totalQuadArea(second)).toBe(10 + 6)
      expect(second.water.length).toBe(6)
      expect(first.water.length).toBe(0)
    }),
  )

  it.effect('gives every layer its own array, so holding one does not pin the others', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [1, 64, 1, STONE],
          [3, 64, 3, WATER],
          [5, 64, 5, GLASS],
        ]),
        {},
        CONFIG,
      )
      expect(layers.opaque).not.toBe(layers.water)
      expect(layers.water).not.toBe(layers.transparentSolid)
      expect(layers.opaque).not.toBe(layers.transparentSolid)
      // An empty layer must be its own empty array too, not one shared constant
      // That a future pooled implementation could hand out and then fill in.
      const empty = meshChunk(emptyChunk(TEST_HEIGHT), {}, CONFIG)
      expect(empty.opaque).not.toBe(empty.water)
    }),
  )
})

/**
 * Chunks built by painting axis-aligned BOXES rather than by scattering cells.
 *
 * This matters more than it looks. A generator of scattered single blocks
 * produces a chunk where almost nothing is face-adjacent, so almost nothing
 * merges, and a property about merging over such chunks is very nearly vacuous —
 * it would pass against a `meshChunk` that did no merging at all. Boxes give
 * long coplanar runs, which is the input the merge is for and the input on which
 * it can be wrong.
 *
 * Two opaque ids (STONE and STONE_B) are in the palette on purpose: a merge that
 * ignored `blockId` and keyed only on "is there a face here" would join them,
 * and no test made only of one opaque id could see it.
 */
const STONE_B = 4

const arbitraryChunkOfBoxes = FastCheck.array(
  FastCheck.tuple(
    FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
    FastCheck.integer({ max: 40, min: 0 }),
    FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
    FastCheck.integer({ max: 6, min: 1 }),
    FastCheck.integer({ max: 6, min: 1 }),
    FastCheck.integer({ max: 6, min: 1 }),
    FastCheck.constantFrom(STONE, STONE_B, WATER, GLASS),
  ),
  { maxLength: 10, minLength: 1 },
).map((boxes) => {
  const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, dx, dy, dz, blockId] of boxes) {
    for (let x = lx; x < Math.min(lx + dx, CHUNK_SIZE); x += 1) {
      for (let z = lz; z < Math.min(lz + dz, CHUNK_SIZE); z += 1) {
        for (let height = y; height < Math.min(y + dy, TEST_HEIGHT); height += 1) {
          blocks[testBlockIndex(x, height, z)] = blockId
        }
      }
    }
  }
  return testChunk(blocks)
})

/** Some of the four horizontal neighbours present, some absent. */
const arbitraryNeighbours: FastCheck.Arbitrary<ChunkNeighbours> = FastCheck.tuple(
  FastCheck.boolean(),
  FastCheck.boolean(),
  FastCheck.boolean(),
  FastCheck.boolean(),
  arbitraryChunkOfBoxes,
).map(([hasXPos, hasXNeg, hasZPos, hasZNeg, neighbour]) => ({
  ...(hasXPos ? { xPos: neighbour } : {}),
  ...(hasXNeg ? { xNeg: neighbour } : {}),
  ...(hasZPos ? { zPos: neighbour } : {}),
  ...(hasZNeg ? { zNeg: neighbour } : {}),
}))

describe('the greedy merge against the naive oracle', () => {
  /**
   * These three properties get 40 s rather than the file's 10 s default, and the
   * number is measured rather than guessed.
   *
   * Each run meshes a whole chunk TWICE -- once merged, once through the naive
   * oracle -- and 120 runs of that is genuinely several seconds of work. Timed
   * on this file:
   *
   *     pnpm vitest run test/mesh.test.ts               4.19 s
   *     pnpm vitest run --coverage test/mesh.test.ts   14.48 s
   *
   * so v8's instrumentation is a 3.5x multiplier, and CI runs the coverage
   * variant on a slower machine than the one those numbers came from. The three
   * properties passed locally and timed out at 10 s on CI, which is the worst
   * shape of flake: green for the author, red for everyone else.
   *
   * `numRuns` is deliberately NOT reduced. These properties are what makes it
   * legitimate to have regenerated the golden hashes when merging changed the
   * emission order -- the argument is "the merged output tiles exactly the same
   * surface", and that argument is only as strong as the number of chunks it was
   * checked against. Trading it for four seconds would quietly weaken the one
   * thing holding up the goldens.
   */

  it.effect('REGRESSION: merged output covers exactly the same block-faces as unmerged output', () =>
    Effect.sync(() => {
      // Meshing-merge-covers-the-same-surface. THE property this whole exercise
      // Rests on, and the one that makes it legitimate to let the emission order
      // Move: the merge is correct precisely when expanding its quads back into
      // Unit faces reproduces the naive mesher's output exactly — same faces,
      // Same block ids, no face lost, no face claimed twice.
      //
      // Multiset equality, not set equality, and the difference is the point. A
      // Merge with an off-by-one that made two quads overlap by a row would
      // Produce the same SET of faces and a larger multiset. Comparing sorted
      // Arrays catches that; comparing `new Set(...)` would not.
      FastCheck.assert(
        FastCheck.property(arbitraryChunkOfBoxes, arbitraryNeighbours, (chunk, neighbours) => {
          const merged = allUnitFaces(meshChunk(chunk, neighbours, CONFIG))
          const naive = allUnitFaces(meshChunkNaive(chunk, neighbours, CONFIG))
          return [...merged].sort().join('|') === [...naive].sort().join('|')
        }),
        { numRuns: 120 },
      )
    }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect('REGRESSION: no two merged quads claim the same block-face', () =>
    Effect.sync(() => {
      // The half of the property above that a coverage-only check would miss,
      // Stated on its own so that a failure says which of the two went wrong.
      // Overlapping quads are z-fighting in the renderer: two coplanar surfaces
      // At the same depth, flickering as the camera moves.
      FastCheck.assert(
        FastCheck.property(arbitraryChunkOfBoxes, arbitraryNeighbours, (chunk, neighbours) => {
          const faces = allUnitFaces(meshChunk(chunk, neighbours, CONFIG))
          return new Set(faces).size === faces.length
        }),
        { numRuns: 120 },
      )
    }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect('never emits more quads than the naive mesher, and usually far fewer', () =>
    Effect.sync(() => {
      // Merging that grows the mesh is not merging. The second half is not
      // Decoration: on box terrain the reduction has to be real, or the property
      // Above is being satisfied by a `meshChunk` that merged nothing.
      let sawRealReduction = false
      FastCheck.assert(
        FastCheck.property(arbitraryChunkOfBoxes, (chunk) => {
          const merged = meshChunk(chunk, {}, CONFIG)
          const naive = meshChunkNaive(chunk, {}, CONFIG)
          if (totalQuadCount(merged) * 2 <= totalQuadCount(naive)) {
            sawRealReduction = true
          }
          return (
            totalQuadCount(merged) <= totalQuadCount(naive) && totalQuadArea(merged) === totalQuadArea(naive)
          )
        }),
        { numRuns: 120 },
      )
      expect(sawRealReduction).toBe(true)
    }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect('REGRESSION: never merges two different block ids, however they are arranged', () =>
    Effect.sync(() => {
      // Meshing-merge-never-crosses-a-block-boundary. Two opaque blocks side by
      // Side present one continuous surface, and a merge keyed on "is a face
      // Exposed here" would happily cover both with one quad carrying one of the
      // Two ids. The result is a stripe of the wrong texture — geometrically
      // Perfect, visibly wrong, and invisible to any test that counts faces or
      // Measures area, because both are unchanged.
      const layers = meshChunk(
        chunkWith([
          [4, 64, 4, STONE],
          [5, 64, 4, STONE_B],
        ]),
        {},
        EMPTY_MESH_CONFIG,
      )
      const tops = layers.opaque.filter((quad) => quad.direction === 'yPos')
      expect(tops.length).toBe(2)
      expect(tops.map((quad) => quad.blockId)).toStrictEqual([STONE, STONE_B])
      expect(tops.every((quad) => quad.width === 1 && quad.height === 1)).toBe(true)

      // Stated as a property too: every unit face a merged quad covers must
      // Really hold that quad's block id in the chunk it came from.
      FastCheck.assert(
        FastCheck.property(arbitraryChunkOfBoxes, (chunk) => {
          const merged = meshChunk(chunk, {}, CONFIG)
          return everyQuad(merged).every((quad) =>
            unitFacesOf(quad).every((face) => {
              const [, position] = face.split(':')
              const [lx, y, lz] = (position ?? '').split(',').map(Number)
              return getBlock(chunk, lx ?? -1, y ?? -1, lz ?? -1) === quad.blockId
            }),
          )
        }),
        { numRuns: 80 },
      )
    }),
  )

  it.effect('REGRESSION: greedily merges opaque faces but keeps transparent faces as unit quads', () =>
    Effect.sync(() => {
      // The layer is a function of the block id, so this follows from the test
      // Above — but it follows only as long as that stays true, and the priority
      // Rule (transparentSolid > water > opaque) is exactly the kind of thing a
      // Future edit could make depend on something else. Pinned directly.
      //
      // A glass sheet laid over water: the two surfaces touch, are coplanar in
      // Four of six directions, and belong to different layers.
      const cells: Array<readonly [number, number, number, number]> = []
      for (let lx = 0; lx < 4; lx += 1) {
        for (let lz = 0; lz < 4; lz += 1) {
          cells.push([lx, 64, lz, WATER])
          cells.push([lx, 65, lz, GLASS])
        }
      }
      const layers = meshChunk(chunkWith(cells), {}, CONFIG)
      expect(layers.opaque.length).toBe(0)
      expect(layers.water.every((quad) => quad.blockId === WATER)).toBe(true)
      expect(layers.transparentSolid.every((quad) => quad.blockId === GLASS)).toBe(true)
      // Transparent geometry is intentionally conservative: alpha sorting and
      // Future per-cell material state must not be hidden inside a merged quad.
      const glassTop = layers.transparentSolid.filter((quad) => quad.direction === 'yPos')
      expect(glassTop.length).toBe(16)
      expect(glassTop.every((quad) => quad.width === 1 && quad.height === 1)).toBe(true)

      const opaqueSheet = chunkWith(
        Array.from({ length: 16 }, (_, index) => [index % 4, 64, Math.floor(index / 4), STONE] as const),
      )
      const opaqueTop = meshChunk(opaqueSheet, {}, CONFIG).opaque.filter((quad) => quad.direction === 'yPos')
      expect(opaqueTop).toHaveLength(1)
      expect([opaqueTop[0]?.width, opaqueTop[0]?.height]).toStrictEqual([4, 4])
    }),
  )

  it.effect('REGRESSION: does not merge two faces whose ambient occlusion differs', () =>
    Effect.sync(() => {
      // Meshing-merge-splits-on-ambient-occlusion. The half of AO that lives in
      // This file rather than in test/ambient-occlusion.test.ts: not what the
      // Value is, but that the merge is keyed on it.
      //
      // A 1x2 run of stone along X at y=64, and an OVERHANG one block up and one
      // Block out in +Z. The +Z faces of (8,64,8) and (9,64,8) are coplanar,
      // Adjacent along X — the first tangent axis of a +Z face — the same block
      // And the same direction: every condition the pre-AO merge needed. The
      // Overhang at (8,65,9) is a sampled neighbour of the first face's air cell
      // And not of the second's, so it darkens one and not the other.
      //
      // The overhang is DIAGONAL to both blocks, which is the point of choosing
      // It: it changes the shading without touching the culling, so the split
      // Below can only be AO. (The obvious fixture — an L, with the third block
      // At (8,64,9) — does not work at all: it is face-adjacent, so it culls the
      // Very face the test wants to compare.)
      const chunk = chunkWith([
        [8, 64, 8, STONE],
        [9, 64, 8, STONE],
        [8, 65, 9, STONE],
      ])
      const layers = meshChunk(chunk, {}, EMPTY_MESH_CONFIG)
      const zPos = layers.opaque.filter((quad) => quad.direction === 'zPos')

      // Both faces are still emitted, still 1x1, and they do NOT merge.
      expect(zPos.filter((quad) => quad.lz === 8).map((quad) => [quad.lx, quad.width, quad.height, quad.ao]))
        .toStrictEqual([
          [8, 1, 1, 1],
          [9, 1, 1, 0],
        ])

      // And the pair really would have merged without the shading difference.
      // Stated by removing the overhang and showing the SAME two faces become
      // One quad, so the split above is not a claim about some other
      // Obstruction — the fixtures differ in exactly one diagonal block.
      const withoutTheCorner = meshChunk(
        chunkWith([
          [8, 64, 8, STONE],
          [9, 64, 8, STONE],
        ]),
        {},
        EMPTY_MESH_CONFIG,
      )
      const mergedPair = withoutTheCorner.opaque.filter((quad) => quad.direction === 'zPos')
      expect(mergedPair.map((quad) => [quad.lx, quad.width, quad.height, quad.ao])).toStrictEqual([[8, 2, 1, 0]])

      // THE POINT: splitting costs quads and must not cost SURFACE. Both meshes
      // Cover exactly what the naive mesher covers.
      expect(totalQuadArea(layers)).toBe(totalQuadArea(meshChunkNaive(chunk, {}, EMPTY_MESH_CONFIG)))
    }),
  )

  it.effect('REGRESSION: a merged quad’s ao is the ao of every cell it covers, highest registered id included', () =>
    Effect.sync(() => {
      // The mask packs `blockId | (ao << 8)` into one cell and merges on the
      // Whole cell, so this is also the round-trip test for the highest ID that
      // `mc-kernel` currently permits in a chunk.
      //
      // A 4x4 plate of the highest registered ID with a wall along one side, so the plate's top
      // Face carries two AO values and both are non-zero somewhere.
      const cells: Array<readonly [number, number, number, number]> = []
      for (let lx = 4; lx < 8; lx += 1) {
        for (let lz = 4; lz < 8; lz += 1) {
          cells.push([lx, 64, lz, HIGHEST_REGISTERED_BLOCK_ID])
        }
      }
      for (let lz = 4; lz < 8; lz += 1) {
        cells.push([3, 65, lz, HIGHEST_REGISTERED_BLOCK_ID])
      }
      const chunk = chunkWith(cells)
      const layers = meshChunk(chunk, {}, EMPTY_MESH_CONFIG)

      expect(layers.opaque.every((quad) => quad.blockId === HIGHEST_REGISTERED_BLOCK_ID)).toBe(true)
      expect(layers.opaque.every((quad) => quad.ao >= 0 && quad.ao <= AO_MAX)).toBe(true)
      // The wall at lx=3, y=65 darkens the lx=4 column of the plate's top face
      // And nothing further in, so the top splits into exactly two quads.
      const tops = layers.opaque.filter((quad) => quad.direction === 'yPos' && quad.y === 64)
      expect(tops.map((quad) => [quad.lx, quad.width, quad.height, quad.ao])).toStrictEqual([
        [4, 1, 4, 1],
        [5, 3, 4, 0],
      ])

      // Expanded back into unit faces, the merged mesh agrees with the oracle
      // Shade for shade — `unitFacesOf` now carries `ao`.
      expect([...allUnitFaces(layers)].sort()).toStrictEqual(
        [...allUnitFaces(meshChunkNaive(chunk, {}, EMPTY_MESH_CONFIG))].sort(),
      )
    }),
  )

  it.effect('agrees with the oracle on the bench fixtures’ shape: a full solid slab is six quads', () =>
    Effect.sync(() => {
      // The flat-terrain case the benchmark reports on, at chunk scale. A solid
      // 16x16 layer spanning the whole chunk footprint has no side faces at all
      // When no neighbour is present — the rim faces the chunk boundary, which
      // Reads as air, so they ARE emitted. 16x16 top, 16x16 bottom, and four
      // 16x1 rims: six quads over 4 * 16 + 2 * 256 block-faces.
      const cells: Array<readonly [number, number, number, number]> = []
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          cells.push([lx, 64, lz, STONE])
        }
      }
      const layers = meshChunk(chunkWith(cells), {}, EMPTY_MESH_CONFIG)
      expect(totalQuadCount(layers)).toBe(6)
      expect(totalQuadArea(layers)).toBe(2 * CHUNK_SIZE * CHUNK_SIZE + 4 * CHUNK_SIZE)
      expect(totalQuadArea(layers)).toBe(totalQuadArea(meshChunkNaive(chunkWith(cells), {}, EMPTY_MESH_CONFIG)))
    }),
  )
})

describe('the Y scan ceiling', () => {
  it.effect('REGRESSION: a block at the very top of the chunk is still meshed', () =>
    Effect.sync(() => {
      // `solidCeiling` exists to skip the empty air column above the terrain,
      // And an off-by-one in it removes the topmost layer of the world silently:
      // Every other test in this file uses y=64 or below and would stay green.
      const layers = meshChunk(chunkWith([[3, TEST_HEIGHT - 1, 3, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(new Set(layers.opaque.map(positionOf))).toStrictEqual(new Set([`3,${TEST_HEIGHT - 1},3`]))
    }),
  )

  it.effect('does not let a high block change what is emitted for a low one', () =>
    Effect.sync(() => {
      // The ceiling is chunk-wide, so a single tall pillar raises it for every
      // Column. If the ceiling were ever applied per column instead, this is the
      // Case that would notice: the low block's faces must be identical either
      // Way.
      const low = meshChunk(chunkWith([[8, 4, 8, STONE]]), {}, EMPTY_MESH_CONFIG)
      const withTower = meshChunk(
        chunkWith([
          [8, 4, 8, STONE],
          [0, TEST_HEIGHT - 1, 0, STONE],
        ]),
        {},
        EMPTY_MESH_CONFIG,
      )
      const around = (layers: MeshLayers): ReadonlyArray<string> =>
        allUnitFaces(layers)
          .filter((face) => face.includes(',4,'))
          .sort()
      expect(around(withTower)).toStrictEqual(around(low))
      expect(totalQuadCount(withTower)).toBe(12)
    }),
  )

  it.effect('an all-air chunk short-circuits to three empty layers that are still distinct arrays', () =>
    Effect.sync(() => {
      const layers = meshChunk(emptyChunk(TEST_HEIGHT), {}, CONFIG)
      expect(totalQuadCount(layers)).toBe(0)
      expect(totalQuadArea(layers)).toBe(0)
      // The early return for an empty chunk must not start handing out one
      // Shared empty array; `result ownership` below relies on it not doing so.
      expect(layers.opaque).not.toBe(layers.water)
      expect(layers.water).not.toBe(layers.transparentSolid)
    }),
  )

})

describe('getBlock', () => {
  it.effect('returns AIR when the block accessor has no value', () =>
    Effect.sync(() => {
      const chunk = {
        blocks: { get: () => null },
        height: TEST_HEIGHT,
      } as unknown as ChunkView
      expect(getBlock(chunk, 0, 0, 0)).toBe(AIR)
    }),
  )

  it.effect('returns AIR for every out-of-range coordinate instead of throwing or returning undefined', () =>
    Effect.sync(() => {
      const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
      blocks[testBlockIndex(0, 0, 0)] = STONE
      const chunk = testChunk(blocks)
      for (const [lx, y, lz] of [
        [-1, 0, 0],
        [CHUNK_SIZE, 0, 0],
        [0, -1, 0],
        [0, TEST_HEIGHT, 0],
        [0, 0, -1],
        [0, 0, CHUNK_SIZE],
      ] as const) {
        expect(getBlock(chunk, lx, y, lz)).toBe(AIR)
      }
      expect(getBlock(chunk, 0, 0, 0)).toBe(STONE)
    }),
  )

  it.effect('agrees with blockIndex over the whole chunk, so the storage layout is the documented one', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
          FastCheck.integer({ max: TEST_HEIGHT - 1, min: 0 }),
          FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
          (lx, y, lz) => {
            const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
            blocks[testBlockIndex(lx, y, lz)] = STONE
            return getBlock(testChunk(blocks), lx, y, lz) === STONE
          },
        ),
        { numRuns: 200 },
      )
    }),
  )
})
