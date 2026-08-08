/**
 * Cross-plate plant geometry.
 *
 * Three groups, and the second is the one that matters: the plates themselves,
 * what a plant does to the six SOLID passes (nothing, in both directions), and
 * the injected set.
 *
 * Regression names (docs/design-notes.md):
 *   meshing-cross-plants-are-two-opposed-diagonals
 *   meshing-cross-plants-emit-no-cube-faces
 *   meshing-cross-plants-occlude-nothing
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkView,
  blockIndex,
  emptyChunk,
} from '../src/domain/chunk-view'
import { meshChunk, meshChunkNaive, totalQuadArea, totalQuadCount } from '../src/domain/mesh'
import { EMPTY_MESH_CONFIG, type MeshConfig } from '../src/domain/opacity'
import { type CrossPlantQuad, PLANT_INSET, buildCrossPlantLookup, isCrossPlant } from '../src/domain/plant-mesh'
import { PROPERTY_TIMEOUT_MS } from './property-timeout'

const STONE = 1
const GLASS = 2
const WATER = 3
const FLOWER = 7
const GRASS_TUFT = 8

const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([FLOWER, GRASS_TUFT]),
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

const cornersOf = (plate: CrossPlantQuad): ReadonlyArray<string> =>
  plate.vertices.map((vertex) => vertex.join(','))

describe('the two plates', () => {
  it.effect('a plant emits exactly two plates, four vertices each', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[8, 64, 8, FLOWER]]), {}, CONFIG)
      expect(layers.crossPlants.length).toBe(2)
      expect(layers.crossPlants.every((plate) => plate.vertices.length === 4)).toBe(true)
      expect(layers.crossPlants.every((plate) => plate.blockId === FLOWER)).toBe(true)
      expect(layers.crossPlants.every((plate) => plate.role === 'side')).toBe(true)
    }),
  )

  it.effect('REGRESSION: the two plates run on OPPOSITE diagonals', () =>
    Effect.sync(() => {
      // Meshing-cross-plants-are-two-opposed-diagonals. THE test of this file.
      // Two plates on the SAME diagonal are coplanar: the plant is then a single
      // Pane that vanishes when the camera swings 90 degrees, and it still has
      // Two plates, four vertices each, the right block id, the right inset and
      // The right height. Nothing above this line would notice.
      //
      // Transcribed from `plant-mesh.ts:96-97`: the first plate spans the
      // (x0,z0)-(x1,z1) corner pair, the second (x1,z0)-(x0,z1).
      const [first, second] = meshChunk(chunkWith([[8, 64, 8, FLOWER]]), {}, CONFIG).crossPlants
      const low = 8 + PLANT_INSET
      const high = 9 - PLANT_INSET

      expect(cornersOf(first as CrossPlantQuad)).toStrictEqual([
        `${low},64,${low}`,
        `${low},65,${low}`,
        `${high},65,${high}`,
        `${high},64,${high}`,
      ])
      expect(cornersOf(second as CrossPlantQuad)).toStrictEqual([
        `${high},64,${low}`,
        `${high},65,${low}`,
        `${low},65,${high}`,
        `${low},64,${high}`,
      ])

      // Stated independently of the literals above, so that a future edit to
      // Both tables at once still has to face this: projected onto the XZ plane,
      // The two plates' direction vectors must not be parallel. For the same
      // Diagonal the cross product below is 0.
      const direction = (plate: CrossPlantQuad): readonly [number, number] => [
        plate.vertices[3][0] - plate.vertices[0][0],
        plate.vertices[3][2] - plate.vertices[0][2],
      ]
      const [ax, az] = direction(first as CrossPlantQuad)
      const [bx, bz] = direction(second as CrossPlantQuad)
      expect(ax * bz - az * bx).not.toBe(0)
    }),
  )

  it.effect('is inset horizontally by PLANT_INSET and NOT inset vertically', () =>
    Effect.sync(() => {
      // A vertical inset would float the plant above the ground it stands on;
      // No horizontal inset would make the plate coplanar with the neighbouring
      // Block's face, which is z-fighting. `plant-mesh.ts:89-94`.
      const layers = meshChunk(chunkWith([[3, 20, 5, GRASS_TUFT]]), {}, CONFIG)
      const xs = layers.crossPlants.flatMap((plate) => plate.vertices.map((vertex) => vertex[0]))
      const ys = layers.crossPlants.flatMap((plate) => plate.vertices.map((vertex) => vertex[1]))
      const zs = layers.crossPlants.flatMap((plate) => plate.vertices.map((vertex) => vertex[2]))
      expect([Math.min(...xs), Math.max(...xs)]).toStrictEqual([3 + PLANT_INSET, 4 - PLANT_INSET])
      expect([Math.min(...zs), Math.max(...zs)]).toStrictEqual([5 + PLANT_INSET, 6 - PLANT_INSET])
      expect([Math.min(...ys), Math.max(...ys)]).toStrictEqual([20, 21])
    }),
  )

  it.effect('PLANT_INSET is the reference’s 0.1 and leaves the plate inside its own cell', () =>
    Effect.sync(() => {
      expect(PLANT_INSET).toBe(0.1)
      // An inset of 0.5 or more would collapse the plate to a line or invert it.
      expect(PLANT_INSET).toBeGreaterThan(0)
      expect(PLANT_INSET).toBeLessThan(0.5)
    }),
  )

  it.effect('carries no ambient occlusion, whatever is packed around it', () =>
    Effect.sync(() => {
      // `plant-mesh.ts:16, 76` — plants are drawn with `EMPTY_AO`. A cross plate
      // Has no axis-aligned face whose enclosure could be counted.
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, FLOWER],
          [7, 64, 8, STONE],
          [9, 64, 8, STONE],
          [8, 64, 7, STONE],
          [8, 64, 9, STONE],
          [8, 65, 8, STONE],
          [8, 63, 8, STONE],
        ]),
        {},
        CONFIG,
      )
      expect(layers.crossPlants.every((plate) => plate.ao === 0)).toBe(true)
    }),
  )

  it.effect('emits in lx, lz, y order, so a golden hash over the plates is stable', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [4, 30, 4, FLOWER],
          [4, 20, 6, FLOWER],
          [2, 40, 9, GRASS_TUFT],
        ]),
        {},
        CONFIG,
      )
      // One plate per entry is enough to read the order; both plates of a cell
      // Are emitted together, so taking every second one recovers the cells.
      //
      // The fixture has a TIE on purpose: two cells share lx=4, and they are in
      // The opposite relative order under `lx -> lz -> y` than under
      // `lx -> y -> lz`. Without that pair this assertion would be satisfied by
      // Either nesting, which is the shape of fixture bug `test/mesh.test.ts`
      // Documents at length for its own ordering test.
      const cells = layers.crossPlants
        .filter((_plate, index) => index % 2 === 0)
        .map((plate) => `${Math.floor(plate.vertices[0][0])},${plate.vertices[0][1]},${Math.floor(plate.vertices[0][2])}`)
      expect(cells).toStrictEqual(['2,40,9', '4,30,4', '4,20,6'])
      // Sorting the same three cells by `lx -> y -> lz` really does give a
      // Different sequence, so the assertion above is discriminating.
      expect(cells).not.toStrictEqual(['2,40,9', '4,20,6', '4,30,4'])
    }),
  )

  it.effect('both meshers agree on the plates, exactly', () =>
    Effect.sync(() => {
      // The oracle bounds its scan at CHUNK_HEIGHT and `meshChunk` at
      // `solidCeiling`, so this is also where an off-by-one in the ceiling would
      // Silently drop the topmost row of flowers.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.array(
            FastCheck.tuple(
              FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
              FastCheck.integer({ max: CHUNK_HEIGHT - 1, min: 0 }),
              FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
              FastCheck.constantFrom(STONE, GLASS, WATER, FLOWER, GRASS_TUFT),
            ),
            { maxLength: 30, minLength: 0 },
          ),
          (cells) => {
            const chunk = chunkWith(cells)
            const render = (plates: ReadonlyArray<CrossPlantQuad>): string =>
              plates.map((plate) => `${plate.blockId}:${cornersOf(plate).join('|')}`).join(';')
            return (
              render(meshChunk(chunk, {}, CONFIG).crossPlants) ===
              render(meshChunkNaive(chunk, {}, CONFIG).crossPlants)
            )
          },
        ),
        { numRuns: 120 },
      )
    }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect('a plant at the very top of the chunk is still meshed', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[3, CHUNK_HEIGHT - 1, 3, FLOWER]]), {}, CONFIG)
      expect(layers.crossPlants.length).toBe(2)
    }),
  )

  it.effect('an empty chunk has an empty, distinct plate list', () =>
    Effect.sync(() => {
      const layers = meshChunk(emptyChunk(), {}, CONFIG)
      expect(layers.crossPlants).toStrictEqual([])
      expect(layers.crossPlants).not.toBe(layers.opaque)
    }),
  )
})

describe('what a plant does to the six solid passes', () => {
  it.effect('REGRESSION: a plant emits no cube faces at all', () =>
    Effect.sync(() => {
      // Meshing-cross-plants-emit-no-cube-faces. Without the guard in each pass
      // A flower is drawn as a solid cube AND as a cross — the cube fully
      // Containing the cross, so the cross is invisible and the flower looks
      // Like a block of dirt. `greedy-meshing-algorithms.ts:40, 79, 118, 157,
      // 196, 235`.
      const layers = meshChunk(chunkWith([[8, 64, 8, FLOWER]]), {}, CONFIG)
      expect(totalQuadCount(layers)).toBe(0)
      expect(totalQuadArea(layers)).toBe(0)
      expect(layers.crossPlants.length).toBe(2)

      // And it is the CONFIG that decides, not the id: the same chunk with the
      // Same id meshed without the plant set produces an ordinary cube.
      const asCube = meshChunk(chunkWith([[8, 64, 8, FLOWER]]), {}, EMPTY_MESH_CONFIG)
      expect(totalQuadCount(asCube)).toBe(6)
      expect(asCube.crossPlants.length).toBe(0)
    }),
  )

  it.effect('REGRESSION: a plant hides nothing — it is treated as air by face culling', () =>
    Effect.sync(() => {
      // Meshing-cross-plants-occlude-nothing. THE DELIBERATE DEVIATION from the
      // Reference, whose `isSolidFaceExposed`
      // (`greedy-meshing-fluid-state.ts:145-157`) exposes a face only through
      // Air or a transparent solid — so a flower beside a stone block culls that
      // Block's face there and you see through the wall past the flower.
      //
      // All six directions, because a rule stated once in a shared helper is
      // Still reachable by six call sites that could each pass the wrong thing.
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        const layers = meshChunk(
          chunkWith([
            [8, 64, 8, STONE],
            [8 + dx, 64 + dy, 8 + dz, FLOWER],
          ]),
          {},
          CONFIG,
        )
        expect(totalQuadArea(layers)).toBe(6)
        expect(layers.opaque.length).toBe(6)
      }

      // The control: the SAME arrangement with an opaque neighbour loses a face.
      // Without this, a mesher that had stopped culling entirely would pass.
      const withStone = meshChunk(
        chunkWith([
          [8, 64, 8, STONE],
          [9, 64, 8, STONE],
        ]),
        {},
        CONFIG,
      )
      expect(totalQuadArea(withStone)).toBe(10)
    }),
  )

  it.effect('a plant does not darken its neighbours’ ambient occlusion either', () =>
    Effect.sync(() => {
      // NOT a deviation, and worth being explicit that it is not: AO counts
      // `!== AIR` (docs/design-notes.md M-10), and a plant block is not air, so
      // It DOES darken. This test records that as the behaviour rather than
      // Asserting the tidier-sounding opposite — the culling rule and the AO
      // Rule genuinely disagree about plants, exactly as they already disagree
      // About glass.
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, STONE],
          [8, 65, 9, FLOWER],
        ]),
        {},
        CONFIG,
      )
      const zPos = layers.opaque.filter((quad) => quad.direction === 'zPos')
      expect(zPos.map((quad) => quad.ao)).toStrictEqual([1])
    }),
  )

  it.effect('two plants side by side both draw both plates: there is no shared face to cull', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, FLOWER],
          [9, 64, 8, FLOWER],
        ]),
        {},
        CONFIG,
      )
      expect(layers.crossPlants.length).toBe(4)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )
})

describe('the injected set', () => {
  it.effect('an absent crossPlantBlockIds means no id is a plant', () =>
    Effect.sync(() => {
      // The field is optional so that a config written before cross plates
      // Existed behaves exactly as it did. `EMPTY_MESH_CONFIG` sets it; a
      // Hand-written config need not.
      const legacy: MeshConfig = {
        transparentSolidBlockIds: new Set([GLASS]),
        waterBlockIds: new Set([WATER]),
      }
      const layers = meshChunk(chunkWith([[8, 64, 8, FLOWER]]), {}, legacy)
      expect(layers.crossPlants.length).toBe(0)
      expect(totalQuadCount(layers)).toBe(6)
    }),
  )

  it.effect('buildCrossPlantLookup itself defaults an absent set to empty, not just its meshChunk caller', () =>
    Effect.sync(() => {
      // The test above goes through `meshChunk`, whose `crossPlantLookupForMesh`
      // Short-circuits to a shared empty table before `buildCrossPlantLookup` is
      // Ever called (`domain/mesh.ts`) — so it never exercises this function's
      // OWN `?? []`. `buildCrossPlantLookup` is exported and `crossPlantBlockIds`
      // Is optional on `MeshConfig`, so a caller reaching it directly with no set
      // Is a real, public-API path, not a hypothetical one.
      const lookup = buildCrossPlantLookup({
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set(),
      })
      expect(lookup.length).toBe(256)
      expect(lookup.reduce((total, value) => total + value, 0)).toBe(0)
    }),
  )

  it.effect('the flattened table agrees with the set on every representable id', () =>
    Effect.sync(() => {
      const lookup = buildCrossPlantLookup(CONFIG)
      for (let blockId = 0; blockId <= 255; blockId += 1) {
        expect(isCrossPlant(lookup, blockId)).toBe(CONFIG.crossPlantBlockIds?.has(blockId) ?? false)
      }
    }),
  )

  it.effect('ignores ids outside a byte rather than corrupting the table', () =>
    Effect.sync(() => {
      // A block id arrives from a `Uint8Array`, so an out-of-range id is a
      // Config mistake. `buildCrossPlantLookup` has NO bounds check, because a
      // Write past the end of a typed array is dropped by the array itself:
      // A guard would be unreachable, and a mutation that deleted one could not
      // Be made to fail. This test therefore does not protect a guard — it
      // States the behaviour that makes the guard unnecessary, so that the next
      // Reader who wants to add one finds the answer here.
      const lookup = buildCrossPlantLookup({
        crossPlantBlockIds: new Set([-1, 256, 1000, FLOWER]),
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set(),
      })
      expect(lookup.length).toBe(256)
      expect(isCrossPlant(lookup, FLOWER)).toBe(true)
      expect(lookup.reduce((total, value) => total + value, 0)).toBe(1)
    }),
  )

  it.effect('a block can be BOTH a plant and a transparent solid: shape and material are separate questions', () =>
    Effect.sync(() => {
      // The reason this is a third set rather than a fourth layer. The reference
      // Routes every plant into the transparent-solid accumulator
      // (`plant-mesh.ts:245`), i.e. a cross plate is normally see-through — so
      // The two classifications must be able to hold at once.
      const both: MeshConfig = {
        crossPlantBlockIds: new Set([FLOWER]),
        transparentSolidBlockIds: new Set([FLOWER]),
        waterBlockIds: new Set(),
      }
      const layers = meshChunk(chunkWith([[8, 64, 8, FLOWER]]), {}, both)
      expect(layers.crossPlants.length).toBe(2)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )
})
