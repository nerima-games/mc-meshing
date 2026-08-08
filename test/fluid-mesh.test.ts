/**
 * Fluid surface geometry: how high the water sits, and which way it leans.
 *
 * Six groups. The one that matters most is `the corner averaging`, because that
 * is where flow direction lives and it is the only part of this file whose
 * failure is invisible to a count: every quad can be present, in the right
 * order, with the right block id and the right winding, and the surface still be
 * flat when it should be tilted.
 *
 * Regression names (docs/design-notes.md M-12):
 *   meshing-fluid-height-comes-from-injected-max-level
 *   meshing-fluid-corners-are-the-flow-direction
 *   meshing-fluid-blocks-emit-no-cube-faces
 *   meshing-fluid-surfaces-never-merge
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  blockIndex,
} from '../src/domain/chunk-view'
import { type QuadAxis, tangentAxes } from '../src/domain/faces'
import {
  type FluidQuad,
  SOURCE_SURFACE_HEIGHT,
  buildFluidLookup,
  isFluidBlock,
} from '../src/domain/fluid-mesh'
import { simplifyMesh } from '../src/domain/lod'
import { type MeshLayers, type Quad, meshChunk, meshChunkNaive, totalQuadArea, totalQuadCount } from '../src/domain/mesh'
import { MESH_LAYERS, type MeshConfig } from '../src/domain/opacity'
import { PROPERTY_TIMEOUT_MS } from './property-timeout'

const STONE = 1
const GLASS = 2
const WATER = 3
const LAVA = 4
const FLOWER = 5

/**
 * The two max levels are the REFERENCE'S, injected rather than declared.
 *
 * 7 for water and 3 for lava (`packages/block/domain/fluid-model.ts:15-16`).
 * They are written here, in a test, precisely because `domain/` must not name
 * them: a test may spell another repository's numbers to check that they are
 * honoured, where the library spelling them would be a second source of truth.
 * The two fluids deliberately have DIFFERENT max levels, so that every height
 * assertion below fails if the code substitutes a constant for the injected one.
 */
const WATER_MAX_LEVEL = 7
const LAVA_MAX_LEVEL = 3

const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([FLOWER]),
  fluidMaxLevels: new Map([
    [WATER, WATER_MAX_LEVEL],
    [LAVA, LAVA_MAX_LEVEL],
  ]),
  transparentSolidBlockIds: new Set([GLASS]),
  waterBlockIds: new Set([WATER]),
}

/** The same config with the fluid table removed: water goes back to being a cube. */
const CUBE_WATER_CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([FLOWER]),
  transparentSolidBlockIds: new Set([GLASS]),
  waterBlockIds: new Set([WATER]),
}

type BlockCell = readonly [number, number, number, number]
/** `lx, y, lz, level, source, falling?` — flags use the decoded 0/1 representation. */
type FluidCell = readonly [number, number, number, number, number, number?]

const chunkWith = (cells: ReadonlyArray<BlockCell>, fluidCells: ReadonlyArray<FluidCell> = []): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz)] = blockId
  }
  if (fluidCells.length === 0) {
    return { blocks }
  }
  const levels = new Uint8Array(BLOCKS_PER_CHUNK)
  const sources = new Uint8Array(BLOCKS_PER_CHUNK)
  const falling = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, level, source, isFalling = 0] of fluidCells) {
    levels[blockIndex(lx, y, lz)] = level
    sources[blockIndex(lx, y, lz)] = source
    falling[blockIndex(lx, y, lz)] = isFalling
  }
  return { blocks, fluid: { falling, levels, sources } }
}

/** The one quad facing `direction`, or `undefined`. Fails loudly if there are two. */
const faceOfDirection = (quads: ReadonlyArray<FluidQuad>, direction: string): FluidQuad | undefined => {
  const found = quads.filter((quad) => quad.direction === direction)
  expect(found.length).toBeLessThanOrEqual(1)
  return found[0]
}

/** Every Y a quad's four vertices sit at, in vertex order. */
const ysOf = (quad: FluidQuad): ReadonlyArray<number> => quad.vertices.map((vertex) => vertex[1])

const topAt = (quads: ReadonlyArray<FluidQuad>, lx: number, lz: number): FluidQuad | undefined =>
  quads.find((quad) => quad.direction === 'yPos' && quad.vertices[0][0] === lx && quad.vertices[0][2] === lz)

describe('the height of one cell', () => {
  it.effect('a source sits at the reference’s 14/16, not flush with the cell top', () =>
    Effect.sync(() => {
      // Meshing-fluid-height-comes-from-injected-max-level.
      // `greedy-meshing-fluid-state.ts:37`, and the reason is in its comment
      // (:32-36): a source flush with the top of its cell meets the grass beside
      // It at the grass's own height and the shoreline reads as a glass wall.
      expect(SOURCE_SURFACE_HEIGHT).toBe(14 / 16)

      const layers = meshChunk(chunkWith([[8, 64, 8, WATER]], [[8, 64, 8, 0, 1]]), {}, CONFIG)
      const top = faceOfDirection(layers.fluids, 'yPos')
      expect(ysOf(top as FluidQuad)).toStrictEqual([64.875, 64.875, 64.875, 64.875])
    }),
  )

  it.effect('a non-source cell drops one step per level, sized by the INJECTED max level', () =>
    Effect.sync(() => {
      // `1 - level / (maxLevel + 1)` (`greedy-meshing-fluid-state.ts:39-43`).
      // Water's step is 1/8 and lava's is 1/4, and they are different on purpose:
      // A max level hard-coded on either side of the seam gives one of the two
      // Fluids the other's steps, and every assertion in this test notices.
      const heightOf = (blockId: number, level: number): number => {
        const chunk = chunkWith([[8, 64, 8, blockId]], [[8, 64, 8, level, 0]])
        const top = faceOfDirection(meshChunk(chunk, {}, CONFIG).fluids, 'yPos')
        return (ysOf(top as FluidQuad)[0] as number) - 64
      }

      expect(heightOf(WATER, 0)).toBe(1)
      expect(heightOf(WATER, 1)).toBe(7 / 8)
      expect(heightOf(WATER, 4)).toBe(4 / 8)
      expect(heightOf(WATER, 7)).toBe(1 / 8)

      expect(heightOf(LAVA, 0)).toBe(1)
      expect(heightOf(LAVA, 1)).toBe(3 / 4)
      expect(heightOf(LAVA, 3)).toBe(1 / 4)
    }),
  )

  it.effect('the height has a FLOOR of one step, so the emptiest cell is still visible', () =>
    Effect.sync(() => {
      // The `max` in `greedy-meshing-fluid-state.ts:42`. Without it a level past
      // The maximum gives height 0 — a zero-height sheet lying exactly on the
      // Ground, which z-fights with it and vanishes at grazing angles.
      const heightOf = (blockId: number, level: number): number => {
        const chunk = chunkWith([[8, 64, 8, blockId]], [[8, 64, 8, level, 0]])
        const top = faceOfDirection(meshChunk(chunk, {}, CONFIG).fluids, 'yPos')
        return (ysOf(top as FluidQuad)[0] as number) - 64
      }

      // Levels past the injected maximum, which is what the floor is there for.
      expect(heightOf(WATER, 8)).toBe(1 / 8)
      expect(heightOf(WATER, 12)).toBe(1 / 8)
      expect(heightOf(LAVA, 4)).toBe(1 / 4)
      expect(heightOf(LAVA, 9)).toBe(1 / 4)
    }),
  )

  it.effect('a submerged cell is FULL, so a deep lake is one surface and not a stack of sheets', () =>
    Effect.sync(() => {
      // `fluidSurfaceHeightForColumn` (`greedy-meshing-fluid-state.ts:74-87`):
      // Same fluid directly above means height 1, whatever this cell's own level
      // Says. Without it the 14/16 inset appears at every depth and a lake
      // Renders as separated sheets with gaps a player can see through.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [8, 65, 8, WATER],
        ],
        [
          [8, 64, 8, 0, 1],
          [8, 65, 8, 0, 1],
        ],
      )
      const layers = meshChunk(chunk, {}, CONFIG)

      // Exactly one top, and it belongs to the upper cell.
      const tops = layers.fluids.filter((quad) => quad.direction === 'yPos')
      expect(tops.length).toBe(1)
      expect(ysOf(tops[0] as FluidQuad)).toStrictEqual([65.875, 65.875, 65.875, 65.875])

      // And the LOWER cell's own sides run to a full 65, not to 64.875: the
      // Submerged rule feeds the corner averaging too, so the wall of the lake
      // Has no notch at every cell boundary.
      const lowerSides = layers.fluids.filter((quad) => quad.direction === 'xPos' && quad.vertices[1][1] <= 65)
      expect(lowerSides.length).toBe(1)
      expect(ysOf(lowerSides[0] as FluidQuad)).toStrictEqual([64, 65, 65, 64])
    }),
  )

  it.effect('fluid on the world’s TOP ROW still shows a surface', () =>
    Effect.sync(() => {
      // Two things at once, and both are load-bearing.
      //
      // 1. `solidCeiling`'s off-by-one. Every other test here sits around y=64,
      //    So a scan ceiling that stopped one row short would leave them all
      //    Green and silently delete the top row of the world —— the same fault
      //    `test/mesh.test.ts`'s `the Y scan ceiling` group exists for.
      // 2. `heightIn` carries NO y-range check, because `getBlock` already
      //    Answers out-of-range with `AIR`. This is the case that exercises it:
      //    The corner averaging probes `y + 1`, which is `CHUNK_HEIGHT` here.
      //    A statement of the behaviour, not a guard being defended.
      const top = CHUNK_HEIGHT - 1
      const chunk = chunkWith([[8, top, 8, WATER]], [[8, top, 8, 0, 1]])
      const layers = meshChunk(chunk, {}, CONFIG)

      expect(layers.fluids.length).toBe(5)
      const surface = faceOfDirection(layers.fluids, 'yPos')
      expect(ysOf(surface as FluidQuad)).toStrictEqual([
        top + 0.875,
        top + 0.875,
        top + 0.875,
        top + 0.875,
      ])
      expect(layers.fluids.every((quad) => ysOf(quad).every((y) => Number.isFinite(y)))).toBe(true)
    }),
  )

  it.effect('a missing FluidView reads as full, non-source cells rather than as no fluid', () =>
    Effect.sync(() => {
      // A caller holding block ids but no simulation state yet gets flat
      // Full-height fluid. The alternative — treating absent state as absent
      // Fluid — makes every lake INVISIBLE, because the cube passes have already
      // Skipped it. Same instinct as `getBlock` returning AIR for an absent
      // Neighbour: degrade to the answer that still shows the player a world.
      const layers = meshChunk(chunkWith([[8, 64, 8, WATER]]), {}, CONFIG)
      const top = faceOfDirection(layers.fluids, 'yPos')
      expect(ysOf(top as FluidQuad)).toStrictEqual([65, 65, 65, 65])
    }),
  )
})

describe('the corner averaging', () => {
  it.effect('REGRESSION: the surface TILTS toward the emptier neighbour', () =>
    Effect.sync(() => {
      // The top patch's SLOPE is independent of its renderer-facing flow
      // Descriptor. It exists because each corner is the mean of the up-to-four
      // Columns touching it
      // (`greedy-meshing-fluid-state.ts:89-113`). Replace that average with the
      // Cell's own height and every quad is still emitted, in the right order,
      // With the right winding and the right block id — and every lake in the
      // World is a flat plate with a stair-step edge.
      //
      // Full cell at lx=8 (height 1), half-full at lx=9 (level 4 -> 1/2).
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
        ],
        [
          [8, 64, 8, 0, 0],
          [9, 64, 8, 4, 0],
        ],
      )
      const layers = meshChunk(chunk, {}, CONFIG)
      const top = layers.fluids.find((quad) => quad.direction === 'yPos' && quad.vertices[0][0] === 8)

      // Winding is (0,0), (0,1), (1,1), (1,0) — the reference's, at :82-85. The
      // Two corners on the lx=8 side see only the full cell; the two on the lx=9
      // Side average the full cell with the half-full one.
      expect(ysOf(top as FluidQuad)).toStrictEqual([65, 65, 64.75, 64.75])

      // Stated independently of the literals above: whatever the numbers, the
      // +X edge must sit LOWER than the -X edge. An edit that "fixes" both
      // Literals at once still has to face this.
      const ys = ysOf(top as FluidQuad)
      expect(Math.max(ys[2] as number, ys[3] as number)).toBeLessThan(Math.min(ys[0] as number, ys[1] as number))
    }),
  )

  it.effect('a lone cell has four equal corners: no neighbours, no slope', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[8, 64, 8, WATER]], [[8, 64, 8, 4, 0]])
      const top = faceOfDirection(meshChunk(chunk, {}, CONFIG).fluids, 'yPos')
      expect(ysOf(top as FluidQuad)).toStrictEqual([64.5, 64.5, 64.5, 64.5])
    }),
  )

  it.effect('the cell is always one of its own corner samples, so no corner is ever NaN', () =>
    Effect.sync(() => {
      // `cornerHeight` divides by `sampleCount` and carries NO guard against
      // Zero, because the cell that reached it resolved to the fluid being asked
      // About and is one of the four samples of all four of its own corners. A
      // Guard would be the unreachable branch M-11 removed from
      // `buildCrossPlantLookup` after no mutation could make it fail. This test
      // Is the statement that the reasoning holds, at every corner of the chunk
      // — which is where a sampler that walked off the edge would divide by 0.
      for (const [lx, lz] of [
        [0, 0],
        [0, CHUNK_SIZE - 1],
        [CHUNK_SIZE - 1, 0],
        [CHUNK_SIZE - 1, CHUNK_SIZE - 1],
      ]) {
        const chunk = chunkWith([[lx as number, 64, lz as number, WATER]], [[lx as number, 64, lz as number, 2, 0]])
        const quads = meshChunk(chunk, {}, CONFIG).fluids
        expect(quads.length).toBeGreaterThan(0)
        for (const quad of quads) {
          for (const y of ysOf(quad)) {
            expect(Number.isFinite(y)).toBe(true)
          }
        }
      }
    }),
  )
})

describe('the renderer flow descriptor', () => {
  it.effect('source and flat flow state are horizontally still', () =>
    Effect.sync(() => {
      const source = chunkWith([[4, 64, 4, WATER]], [[4, 64, 4, 0, 1]])
      const flat = chunkWith([[12, 64, 12, WATER]], [[12, 64, 12, 0, 0]])

      expect(topAt(meshChunk(source, {}, CONFIG).fluids, 4, 4)?.flow).toStrictEqual({
        direction: [0, 0],
        falling: false,
      })
      expect(topAt(meshChunk(flat, {}, CONFIG).fluids, 12, 12)?.flow).toStrictEqual({
        direction: [0, 0],
        falling: false,
      })
    }),
  )

  it.effect('water and lava point toward the lower same-fluid neighbour', () =>
    Effect.sync(() => {
      for (const [blockId, lowLevel] of [
        [WATER, WATER_MAX_LEVEL],
        [LAVA, LAVA_MAX_LEVEL],
      ] as const) {
        const chunk = chunkWith(
          [
            [8, 64, 8, blockId],
            [9, 64, 8, blockId],
          ],
          [
            [8, 64, 8, 0, 0],
            [9, 64, 8, lowLevel, 0],
          ],
        )
        expect(topAt(meshChunk(chunk, {}, CONFIG).fluids, 8, 8)?.flow?.direction).toStrictEqual([1, 0])
      }
    }),
  )

  it.effect('combined X/Z gradients are normalized deterministically', () =>
    Effect.sync(() => {
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
          [8, 64, 7, WATER],
        ],
        [
          [8, 64, 8, 0, 0],
          [9, 64, 8, 4, 0],
          [8, 64, 7, 4, 0],
        ],
      )
      const direction = topAt(meshChunk(chunk, {}, CONFIG).fluids, 8, 8)?.flow?.direction
      expect(direction?.[0]).toBeCloseTo(Math.SQRT1_2)
      expect(direction?.[1]).toBeCloseTo(-Math.SQRT1_2)
    }),
  )

  it.effect('falling state is explicit and side skirts do not duplicate the top descriptor', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[8, 64, 8, WATER]], [[8, 64, 8, 0, 0, 1]])
      const quads = meshChunk(chunk, {}, CONFIG).fluids
      expect(topAt(quads, 8, 8)?.flow).toStrictEqual({ direction: [0, 0], falling: true })
      expect(quads.filter((quad) => quad.direction !== 'yPos').every((quad) => !quad.flow)).toBe(true)
    }),
  )

  it.effect('a stream crossing a ledge points toward the same fluid one cell below', () =>
    Effect.sync(() => {
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [9, 63, 8, WATER],
        ],
        [
          [8, 64, 8, 0, 0],
          [9, 63, 8, 0, 0],
        ],
      )
      expect(topAt(meshChunk(chunk, {}, CONFIG).fluids, 8, 8)?.flow?.direction).toStrictEqual([1, 0])
    }),
  )

  it.effect('a loaded chunk neighbour contributes to flow while a missing neighbour stays neutral', () =>
    Effect.sync(() => {
      const last = CHUNK_SIZE - 1
      const chunk = chunkWith([[last, 64, 8, WATER]], [[last, 64, 8, 0, 0]])
      const xPos = chunkWith([[0, 64, 8, WATER]], [[0, 64, 8, WATER_MAX_LEVEL, 0]])

      expect(topAt(meshChunk(chunk, { xPos }, CONFIG).fluids, last, 8)?.flow?.direction).toStrictEqual([1, 0])
      expect(topAt(meshChunk(chunk, {}, CONFIG).fluids, last, 8)?.flow?.direction).toStrictEqual([0, 0])
    }),
  )
})

describe('which fluid faces exist', () => {
  it.effect('an isolated cell emits a top and four sides — five faces, never six', () =>
    Effect.sync(() => {
      // FIVE, NOT SIX. The reference's fluid pass has no `yNeg` case at all
      // (`greedy-meshing-fluids.ts:70, 92, 120, 148, 176` and nothing else), so
      // The underside of a lake is not drawn and a swimmer below one sees
      // Through it. Transcribed rather than endorsed — docs/design-notes.md M-12
      // Records it as the one visible gap this port did not invent geometry to
      // Close. This test exists so that the gap is a decision on the record and
      // Not something a later reader discovers in a renderer.
      const layers = meshChunk(chunkWith([[8, 64, 8, WATER]], [[8, 64, 8, 0, 1]]), {}, CONFIG)
      expect(layers.fluids.length).toBe(5)
      expect(layers.fluids.map((quad) => quad.direction).sort()).toStrictEqual([
        'xNeg',
        'xPos',
        'yPos',
        'zNeg',
        'zPos',
      ])
      expect(layers.fluids.some((quad) => quad.direction === 'yNeg')).toBe(false)
    }),
  )

  it.effect('an opaque block above hides the top; GLASS above does not — the aquarium rule', () =>
    Effect.sync(() => {
      // `isFluidFaceOccluder` (`greedy-meshing-fluid-state.ts:129-134`): only a
      // TRULY opaque neighbour occludes. Water behind glass must still show its
      // Surface or the tank renders empty.
      const under = (lidId: number): ReadonlyArray<FluidQuad> =>
        meshChunk(
          chunkWith(
            [
              [8, 64, 8, WATER],
              [8, 65, 8, lidId],
            ],
            [[8, 64, 8, 0, 1]],
          ),
          {},
          CONFIG,
        ).fluids

      expect(under(STONE).some((quad) => quad.direction === 'yPos')).toBe(false)
      expect(under(GLASS).some((quad) => quad.direction === 'yPos')).toBe(true)
    }),
  )

  it.effect('fluid ABOVE hides the top even when it is the other fluid', () =>
    Effect.sync(() => {
      // The reference tests `aboveFluid === null` (`greedy-meshing-fluids.ts:69`)
      // And that is false for the other kind too. It has to be that way round: a
      // Fluid is never an occluder, so if this test only looked for the SAME
      // Fluid, neither clause would catch lava and the water's surface would be
      // Drawn inside it.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [8, 65, 8, LAVA],
        ],
        [
          [8, 64, 8, 0, 1],
          [8, 65, 8, 0, 1],
        ],
      )
      const waterQuads = meshChunk(chunk, {}, CONFIG).fluids.filter((quad) => quad.blockId === WATER)
      expect(waterQuads.some((quad) => quad.direction === 'yPos')).toBe(false)
    }),
  )

  it.effect('REGRESSION: neither a fluid nor a plant hides a fluid’s side', () =>
    Effect.sync(() => {
      // Two separate rules meeting in one place.
      //
      // LAVA is not in `waterBlockIds`, so `occludes` classifies it OPAQUE. Only
      // The fluid table stops it hiding the water beside it — take that clause
      // Out and the shore of every lava lake eats the water's edge.
      //
      // A CROSS PLANT is M-11's rule, applied here for consistency rather than
      // Decided again: two diagonal panes filling a tenth of a cell cannot hide
      // A lake's edge.
      const besideWater = (neighbourId: number): ReadonlyArray<FluidQuad> =>
        meshChunk(
          chunkWith(
            [
              [8, 64, 8, WATER],
              [9, 64, 8, neighbourId],
            ],
            [[8, 64, 8, 0, 1]],
          ),
          {},
          CONFIG,
        ).fluids.filter((quad) => quad.blockId === WATER)

      expect(besideWater(LAVA).some((quad) => quad.direction === 'xPos')).toBe(true)
      expect(besideWater(FLOWER).some((quad) => quad.direction === 'xPos')).toBe(true)
      // The control: a genuinely opaque neighbour DOES hide it. Without this an
      // Implementation that occludes nothing at all would pass the two above.
      expect(besideWater(STONE).some((quad) => quad.direction === 'xPos')).toBe(false)
    }),
  )

  it.effect('two cells of equal height share no wall, from either side', () =>
    Effect.sync(() => {
      // The fluid analogue of M-6. `greedy-meshing-fluids.ts:97` skips the skirt
      // When the neighbour is at least as high; without it the inside of a lake
      // Is a grid of walls, which is both wrong and ruinously expensive.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
        ],
        [
          [8, 64, 8, 0, 1],
          [9, 64, 8, 0, 1],
        ],
      )
      const quads = meshChunk(chunk, {}, CONFIG).fluids
      const atSeam = quads.filter(
        (quad) => (quad.direction === 'xPos' || quad.direction === 'xNeg') && quad.vertices[0][0] === 9,
      )
      expect(atSeam).toStrictEqual([])
    }),
  )

  it.effect('REGRESSION: a skirt starts at the NEIGHBOUR’s surface, not at the floor', () =>
    Effect.sync(() => {
      // `greedy-meshing-fluids.ts:94-97`. The skirt covers only the STEP between
      // The two surfaces. Running it to `y` instead buries a wall of fluid inside
      // The lake wherever two cells of different height meet — invisible from
      // Above, and exactly the sort of fault a face count cannot see, because
      // The face count is identical either way.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
        ],
        [
          [8, 64, 8, 0, 0],
          [9, 64, 8, 4, 0],
        ],
      )
      const quads = meshChunk(chunk, {}, CONFIG).fluids
      const step = quads.find((quad) => quad.direction === 'xPos' && quad.vertices[0][0] === 9)

      // Bottom at the neighbour's 64.5, top at this cell's two +X corners.
      expect(ysOf(step as FluidQuad)).toStrictEqual([64.5, 64.75, 64.75, 64.5])

      // And the taller cell owns the step: the shorter one emits nothing back.
      const backwards = quads.filter((quad) => quad.direction === 'xNeg' && quad.vertices[0][0] === 9)
      expect(backwards).toStrictEqual([])
    }),
  )

  it.effect('every fluid face carries zero ambient occlusion', () =>
    Effect.sync(() => {
      // `ZERO_AO` (`greedy-meshing-fluids.ts:13`, used at :52). A fluid surface
      // Is shaded by the water shader, and `domain/ambient-occlusion.ts` samples
      // The tangent neighbours of an axis-aligned UNIT face, which a patch at
      // 0.875 is not. Boxed in on all sides, where a cube face would darken.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [7, 64, 8, STONE],
          [8, 64, 7, STONE],
          [8, 63, 8, STONE],
        ],
        [[8, 64, 8, 0, 1]],
      )
      expect(meshChunk(chunk, {}, CONFIG).fluids.every((quad) => quad.ao === 0)).toBe(true)
    }),
  )
})

describe('what a fluid does to the six cube passes', () => {
  it.effect('REGRESSION: a fluid block emits no cube faces at all', () =>
    Effect.sync(() => {
      // Meshing-fluid-blocks-emit-no-cube-faces. Without the guard a lake is
      // Drawn TWICE — flat at y+1 by the cube passes and again at y+0.875 by the
      // Fluid pass — and the two z-fight along every shoreline. The same failure
      // M-11's plant guard exists to prevent, one step worse because the two
      // Copies are at different heights and so the artefact moves as the camera does.
      const chunk = chunkWith([[8, 64, 8, WATER]], [[8, 64, 8, 0, 1]])

      const withFluid = meshChunk(chunk, {}, CONFIG)
      expect(withFluid.water).toStrictEqual([])
      expect(withFluid.fluids.length).toBe(5)

      // And the control, which is what fixes that it is the CONFIG deciding this
      // And not the block id: the same chunk, the same id, no fluid table.
      const asCube = meshChunk(chunk, {}, CUBE_WATER_CONFIG)
      expect(asCube.water.length).toBe(6)
      expect(asCube.fluids).toStrictEqual([])
    }),
  )

  it.effect('an absent fluid table changes nothing whatsoever', () =>
    Effect.sync(() => {
      // The compatibility claim `domain/opacity.ts` makes for `fluidMaxLevels`,
      // And the reason docs/design-notes.md M-9 and M-10 keep their recorded
      // `layered-water-glass` figures unamended. A config written before this
      // File existed must produce byte-identical output.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [8, 63, 8, STONE],
          [9, 64, 8, GLASS],
        ],
        [[8, 64, 8, 0, 1]],
      )
      const before: MeshConfig = {
        transparentSolidBlockIds: new Set([GLASS]),
        waterBlockIds: new Set([WATER]),
      }
      const after: MeshConfig = { ...before, fluidMaxLevels: new Map<number, number>() }

      expect(meshChunk(chunk, {}, after)).toStrictEqual(meshChunk(chunk, {}, before))
      expect(meshChunk(chunk, {}, before).fluids).toStrictEqual([])
    }),
  )

  it.effect('fluid surfaces are outside totalQuadArea and totalQuadCount', () =>
    Effect.sync(() => {
      // Those two measure the block-face area the merge must conserve and the
      // Count it must reduce. A surface at 0.875 covers no block face, so
      // Counting it would make the merge's central invariant read as violated by
      // A puddle — exactly the argument M-11 made for cross plates.
      const chunk = chunkWith([[8, 64, 8, WATER]], [[8, 64, 8, 0, 1]])
      const layers = meshChunk(chunk, {}, CONFIG)
      expect(layers.fluids.length).toBe(5)
      expect(totalQuadCount(layers)).toBe(0)
      expect(totalQuadArea(layers)).toBe(0)
    }),
  )

  it.effect('a solid block beside water still shows its face — the lake bed renders', () =>
    Effect.sync(() => {
      // A DELIBERATE DIVERGENCE from the reference, and an EXISTING one this
      // Change does not touch. The reference's `isSolidFaceExposed`
      // (`greedy-meshing-fluid-state.ts:145-157`) exposes a solid face only
      // Through air or a transparent solid, so a stone block underwater has no
      // Faces at all there. `domain/mesh.ts` has always used its own layer rule
      // Instead, and the fluid port deliberately left it alone: this row is
      // About fluid geometry, not about re-deciding solid exposure. Pinned here
      // So that the divergence is visible from the fluid side too.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [8, 63, 8, STONE],
        ],
        [[8, 64, 8, 0, 1]],
      )
      const layers = meshChunk(chunk, {}, CONFIG)
      expect(layers.opaque.some((quad) => quad.direction === 'yPos' && quad.y === 63)).toBe(true)
    }),
  )
})

describe('across a chunk boundary', () => {
  const LAST = CHUNK_SIZE - 1
  const waterAt = (lx: number, lz: number, level: number, source: number): ChunkView =>
    chunkWith([[lx, 64, lz, WATER]], [[lx, 64, lz, level, source]])

  /**
   * The four seams, each as (the cell in THIS chunk, the neighbour holding the
   * continuation, the direction of the skirt that must not appear).
   *
   * ALL FOUR, and that is the point of the table. A mutation that reverted just
   * ONE of `heightAcross`'s four branches to the reference's chunk-local read
   * survived an earlier version of this file, which tested `xPos` only — the
   * other three arms were never executed and a lake could have walled itself off
   * along three of its four edges with the suite still green.
   */
  const SEAMS = [
    { here: [LAST, 8] as const, key: 'xPos' as const, side: 'xPos' as const, there: [0, 8] as const },
    { here: [0, 8] as const, key: 'xNeg' as const, side: 'xNeg' as const, there: [LAST, 8] as const },
    { here: [8, LAST] as const, key: 'zPos' as const, side: 'zPos' as const, there: [8, 0] as const },
    { here: [8, 0] as const, key: 'zNeg' as const, side: 'zNeg' as const, there: [8, LAST] as const },
  ]

  it.effect('REGRESSION: a lake continuing into the neighbour grows no wall at the seam', () =>
    Effect.sync(() => {
      // A DELIBERATE DEVIATION from the reference, whose `resolveFluidState`
      // Returns null for anything outside the chunk
      // (`greedy-meshing-fluid-state.ts:52-54`) and which therefore puts a wall
      // Of water inside every lake every 16 blocks, in both axes. M-10 made the
      // Same deviation for ambient occlusion and recorded it; this applies that
      // Decision rather than making a new one.
      for (const seam of SEAMS) {
        const chunk = waterAt(seam.here[0], seam.here[1], 0, 1)
        const neighbour = waterAt(seam.there[0], seam.there[1], 0, 1)
        const neighbours: ChunkNeighbours = { [seam.side]: neighbour }

        const joined = meshChunk(chunk, neighbours, CONFIG).fluids
        expect(joined.some((quad) => quad.direction === seam.key)).toBe(false)

        // The control, per seam: with no neighbour loaded the seam IS a wall,
        // Which is the correct answer there — the lake genuinely ends as far as
        // This chunk can tell, and drawing nothing would open a hole in the
        // World. Without it, an implementation that emitted no side faces at all
        // Would pass the assertion above four times over.
        const alone = meshChunk(chunk, {}, CONFIG).fluids
        expect(alone.some((quad) => quad.direction === seam.key)).toBe(true)
      }
    }),
  )

  it.effect('the neighbour’s LEVELS reach the corner averaging, not just its block ids', () =>
    Effect.sync(() => {
      // The half of the boundary read that a presence-only implementation would
      // Silently skip: it is not enough to know the neighbour has water, the
      // Corner mean needs how MUCH. Half-full water across each seam must tilt
      // This chunk's edge column toward it — checked on all four, for the reason
      // The table above gives.
      //
      // `yOnSide` picks the two corners lying ON the seam. The winding is
      // (0,0), (0,1), (1,1), (1,0) in (x, z), so +X is corners 2 and 3, -X is 0
      // And 1, +Z is 1 and 2, and -Z is 0 and 3.
      const cornersOnSide: Record<string, readonly [number, number]> = {
        xNeg: [0, 1],
        xPos: [2, 3],
        zNeg: [0, 3],
        zPos: [1, 2],
      }

      for (const seam of SEAMS) {
        const chunk = waterAt(seam.here[0], seam.here[1], 0, 1)
        const half = waterAt(seam.there[0], seam.there[1], 4, 0)

        const top = meshChunk(chunk, { [seam.side]: half }, CONFIG).fluids.find(
          (quad) => quad.direction === 'yPos',
        )
        const ys = ysOf(top as FluidQuad)
        const near = cornersOnSide[seam.side] as readonly [number, number]
        const far = [0, 1, 2, 3].filter((index) => !near.includes(index))

        const nearMax = Math.max(...near.map((index) => ys[index] as number))
        const farMin = Math.min(...far.map((index) => ys[index] as number))
        expect(nearMax).toBeLessThan(farMin)
      }
    }),
  )

  it.effect('a diagonal neighbour contributes its level to the shared corner', () =>
    Effect.sync(() => {
      const chunk = waterAt(0, 0, 0, 1)
      const half = waterAt(LAST, LAST, 4, 0)

      const openTop = meshChunk(chunk, {}, CONFIG).fluids.find((quad) => quad.direction === 'yPos')
      const joinedTop = meshChunk(chunk, { xNegZNeg: half }, CONFIG).fluids.find(
        (quad) => quad.direction === 'yPos',
      )
      const open = ysOf(openTop as FluidQuad)
      const joined = ysOf(joinedTop as FluidQuad)

      expect(joined[0]).toBeLessThan(open[0] as number)
      expect(joined.slice(1)).toEqual(open.slice(1))
    }),
  )
})

describe('the injected fluid table', () => {
  it.effect('the map’s keys are the fluid set and its values size the steps', () =>
    Effect.sync(() => {
      const lookup = buildFluidLookup(CONFIG)
      expect(isFluidBlock(lookup, WATER)).toBe(true)
      expect(isFluidBlock(lookup, LAVA)).toBe(true)
      expect(isFluidBlock(lookup, STONE)).toBe(false)
      expect(isFluidBlock(lookup, GLASS)).toBe(false)
      expect(isFluidBlock(lookup, 0)).toBe(false)
    }),
  )

  it.effect('an absent map means no id is a fluid', () =>
    Effect.sync(() => {
      const lookup = buildFluidLookup({
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set([WATER]),
      })
      for (let blockId = 0; blockId <= 255; blockId += 1) {
        expect(isFluidBlock(lookup, blockId)).toBe(false)
      }
    }),
  )

  it.effect('an out-of-byte id and an out-of-byte max level are DESCRIBED, not guarded', () =>
    Effect.sync(() => {
      // The M-11 position, restated. A write past the end of a `Uint8Array` is
      // Dropped by the array itself, by specification, so a bounds guard is
      // Unreachable and permanently uncoverable. A max level of 255 stores
      // 256, which truncates to 0 and reads back as "not a fluid".
      //
      // This test defends no guard. It records what the code does, so that a
      // Future reader meeting invisible lava has somewhere to land.
      const lookup = buildFluidLookup({
        fluidMaxLevels: new Map([
          [300, 7],
          [WATER, 255],
        ]),
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set(),
      })
      expect(isFluidBlock(lookup, WATER)).toBe(false)
      expect(lookup.length).toBe(256)
    }),
  )
})

/**
 * Boxes of a few ids, the same device `test/mesh.test.ts` uses, plus a level for
 * every cell. The ids deliberately include BOTH fluids, a plant and a
 * transparent solid, because the interesting faults are at the meetings: lava
 * against water, glass over a lake, a flower on a shore.
 */
const arbitraryFluidChunk = FastCheck.array(
  FastCheck.record({
    blockId: FastCheck.constantFrom(STONE, GLASS, WATER, LAVA, FLOWER),
    falling: FastCheck.integer({ min: 0, max: 1 }),
    level: FastCheck.integer({ min: 0, max: 8 }),
    lx: FastCheck.integer({ min: 0, max: CHUNK_SIZE - 1 }),
    lz: FastCheck.integer({ min: 0, max: CHUNK_SIZE - 1 }),
    source: FastCheck.integer({ min: 0, max: 1 }),
    sx: FastCheck.integer({ min: 1, max: 4 }),
    sy: FastCheck.integer({ min: 1, max: 3 }),
    sz: FastCheck.integer({ min: 1, max: 4 }),
    y: FastCheck.integer({ min: 0, max: 6 }),
  }),
  { maxLength: 8, minLength: 1 },
).map((boxes): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  const levels = new Uint8Array(BLOCKS_PER_CHUNK)
  const sources = new Uint8Array(BLOCKS_PER_CHUNK)
  const falling = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const box of boxes) {
    for (let {lx} = box; lx < Math.min(box.lx + box.sx, CHUNK_SIZE); lx += 1) {
      for (let {y} = box; y < Math.min(box.y + box.sy, CHUNK_HEIGHT); y += 1) {
        for (let {lz} = box; lz < Math.min(box.lz + box.sz, CHUNK_SIZE); lz += 1) {
          const index = blockIndex(lx, y, lz)
          blocks[index] = box.blockId
          levels[index] = box.level
          sources[index] = box.source
          falling[index] = box.falling
        }
      }
    }
  }
  return { blocks, fluid: { falling, levels, sources } }
})

/** A fluid quad as a string, for multiset comparison. */
const keyOfFluid = (quad: FluidQuad): string =>
  `${quad.blockId}:${quad.direction}:${quad.ao}:${quad.vertices.map((vertex) => vertex.join(',')).join('|')}:` +
  `${quad.flow ? `${quad.flow.direction.join(',')}:${Number(quad.flow.falling)}` : '-'}`

/** Every unit block-face a `Quad` covers — the same translation `test/mesh.test.ts` rests on. */
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

const allUnitFaces = (layers: MeshLayers): ReadonlyArray<string> =>
  MESH_LAYERS.flatMap((layer) => layers[layer].flatMap(unitFacesOf))

describe('the two meshers, and the merge, with fluids configured', () => {
  it.effect(
    'both meshers agree on the fluid surfaces, exactly',
    () =>
      Effect.sync(() => {
        FastCheck.assert(
          FastCheck.property(arbitraryFluidChunk, (chunk) => {
            const merged = meshChunk(chunk, {}, CONFIG).fluids.map(keyOfFluid)
            const naive = meshChunkNaive(chunk, {}, CONFIG).fluids.map(keyOfFluid)
            expect([...merged].sort()).toStrictEqual([...naive].sort())
          }),
        )
      }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect(
    'REGRESSION: the coverage property still holds when fluids are configured',
    () =>
      Effect.sync(() => {
        // `meshing-merge-covers-the-same-surface`, restated under fluids. The
        // Property is unchanged IN FORM and that is the point: it compares
        // `meshChunk` against `meshChunkNaive`, and both exclude fluid ids from
        // The cube passes, so both see the same reduced set of block faces. A
        // Fluid surface is not a block face and never was one, so "the same
        // Surface" means what it always meant. What WOULD break it is excluding
        // Fluids from one mesher and not the other.
        FastCheck.assert(
          FastCheck.property(arbitraryFluidChunk, (chunk) => {
            const merged = allUnitFaces(meshChunk(chunk, {}, CONFIG))
            const naive = allUnitFaces(meshChunkNaive(chunk, {}, CONFIG))
            expect([...merged].sort()).toStrictEqual([...naive].sort())
            expect(totalQuadArea(meshChunk(chunk, {}, CONFIG))).toBe(
              totalQuadArea(meshChunkNaive(chunk, {}, CONFIG)),
            )
          }),
        )
      }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect(
    'REGRESSION: no two fluid quads are identical, and none merges',
    () =>
      Effect.sync(() => {
        // Meshing-fluid-surfaces-never-merge. Two identical fluid quads are two
        // Coplanar surfaces at the same depth, i.e. z-fighting; and because a
        // Merged run of N cells has N+1 corner heights per edge and `Quad` has
        // Room for two, a fluid quad that HAD merged could only have done so by
        // Discarding the intermediate heights — flattening the very slope that
        // Is the feature. Every quad here must therefore describe exactly one cell.
        FastCheck.assert(
          FastCheck.property(arbitraryFluidChunk, (chunk) => {
            const quads = meshChunk(chunk, {}, CONFIG).fluids
            const keys = quads.map(keyOfFluid)
            expect(new Set(keys).size).toBe(keys.length)
            for (const quad of quads) {
              const xs = quad.vertices.map((vertex) => vertex[0])
              const zs = quad.vertices.map((vertex) => vertex[2])
              expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1)
              expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(1)
            }
          }),
        )
      }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect('emits in lx, then y, then lz order', () =>
    Effect.sync(() => {
      // `greedy-meshing-fluids.ts:61-63`. Ties on purpose in every key: two
      // Cells share lx=2, two share y=5, two share lz=2, so each of the three
      // Positions actually decides something. `test/plant-mesh.test.ts` records
      // At length why a fixture without ties accepts any nesting.
      const cells: ReadonlyArray<BlockCell> = [
        [2, 5, 2, WATER],
        [2, 5, 9, WATER],
        [2, 9, 2, WATER],
        [9, 5, 2, WATER],
      ]
      const layers = meshChunk(chunkWith(cells, cells.map(([lx, y, lz]) => [lx, y, lz, 0, 1] as FluidCell)), {}, CONFIG)
      const tops = layers.fluids
        .filter((quad) => quad.direction === 'yPos')
        .map((quad) => `${quad.vertices[0][0]},${Math.floor(quad.vertices[0][1])},${quad.vertices[0][2]}`)
      expect(tops).toStrictEqual(['2,5,2', '2,5,9', '2,9,2', '9,5,2'])
    }),
  )
})

describe('LOD simplification', () => {
  it.effect('passes fluid surfaces through untouched', () =>
    Effect.sync(() => {
      // `snapQuad` snaps two integer tangent extents onto a coarser grid, and a
      // Fluid surface has neither. Worse than merely inapplicable: a lake's
      // Corner heights are SHARED with its neighbours', so snapping one quad's
      // Corner without the abutting one tears the lake open along that seam.
      // Dropping them instead would empty every lake at the first LOD boundary.
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [8, 63, 8, STONE],
        ],
        [[8, 64, 8, 0, 1]],
      )
      const layers = meshChunk(chunk, {}, CONFIG)
      expect(layers.fluids.length).toBeGreaterThan(0)
      expect(simplifyMesh(layers, 1).fluids).toBe(layers.fluids)
      expect(simplifyMesh(layers, 2).fluids).toBe(layers.fluids)
    }),
  )
})
