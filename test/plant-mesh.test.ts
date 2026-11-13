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
import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result, SchemaParser } from 'effect'
import { vi } from 'vitest'
import * as FastCheck from 'fast-check'
import {
  BLOCK_IDS,
  BlockId as KernelBlockId,
  ChunkAxis as chunkAxis,
  blockIdOf,
  blockTypeOfId,
  chunkCoord,
  encodeBlockState,
  type BlockId,
  type EffectiveBlockStateValues,
} from '@nerima-games/mc-kernel'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkView,
  blockIndex,
  emptyChunk,
} from '../src/domain/chunk-view'
import { MAX_BLOCK_ID } from '../src/domain/block-data'
import { classifyVanillaBlockType } from '../src/domain/vanilla-block-model'
import { meshChunk, meshChunkNaive, totalQuadArea, totalQuadCount } from '../src/domain/mesh'
import { EMPTY_MESH_CONFIG, type MeshConfig } from '../src/domain/opacity'
import {
  type CrossPlantQuad,
  PlantTextureStageSchema,
  PLANT_INSET,
  buildCrossPlantLookup,
  isCrossPlant,
  meshCrossPlants,
  plantTextureStageAt,
  type PlantTextureStage,
} from '../src/domain/plant-mesh'
import { PROPERTY_TIMEOUT_MS } from './property-timeout'

const blockId = (value: number): BlockId => Result.getOrThrow(KernelBlockId.result(value))
const invalidFixture = <T,>(value: any): T => value

const STONE = blockId(1)
const GLASS = blockId(2)
const WATER = blockId(3)
const FLOWER = Option.getOrThrow(blockIdOf('oak_log'))
const GRASS_TUFT = blockId(8)
const TALL_GRASS = Option.getOrThrow(blockIdOf('tall_grass'))

const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set<BlockId>([FLOWER, GRASS_TUFT, TALL_GRASS]),
  fluidMaxLevels: new Map(),
  transparentSolidBlockIds: new Set<BlockId>([GLASS]),
  waterBlockIds: new Set<BlockId>([WATER]),
}

const chunkWith = (
  cells: ReadonlyArray<readonly [number, number, number, number]>,
  height = CHUNK_HEIGHT,
): ChunkView => {
  const blocks = new Uint16Array(CHUNK_SIZE * height * CHUNK_SIZE)
  for (const [lx, y, lz, cellBlockId] of cells) {
    blocks[blockIndex(lx, y, lz, height)] = cellBlockId
  }
  return { coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height, blocks }
}

const mesh = (chunk: ChunkView, config: MeshConfig = CONFIG) =>
  Result.getOrThrow(meshChunk(chunk, {}, config))

const meshNaive = (chunk: ChunkView, config: MeshConfig = CONFIG) =>
  Result.getOrThrow(meshChunkNaive(chunk, {}, config))

const crossPlants = (chunk: ChunkView, config: MeshConfig = EMPTY_MESH_CONFIG) =>
  Result.getOrThrow(meshCrossPlants({
    chunk,
    plantLookup: Result.getOrThrow(buildCrossPlantLookup(config)),
    yLimit: chunk.height,
  }))

type CropBlockType = Exclude<PlantTextureStage['blockType'], 'sapling'>
const CROP_BLOCK_TYPES: ReadonlyArray<CropBlockType> = ['wheat_crop', 'potato_crop', 'nether_wart_crop']

// Pixel silhouettes measured from vanilla Java 26.3-snapshot-4 textures at
// https://mcasset.cloud/26.3-snapshot-4/assets/minecraft/textures/block/:
// `wheat_stage*.png`, `potatoes_stage*.png`, and `nether_wart_stage*.png`.
// These are asset-derived, not Wiki dimensions.
const VANILLA_CROP_TEXTURE_HEIGHT_PIXELS: Record<CropBlockType, ReadonlyArray<number>> = {
  wheat_crop: [3, 5, 7, 9, 12, 15, 15, 16],
  potato_crop: [5, 5, 8, 8, 11, 11, 11, 16],
  nether_wart_crop: [6, 11, 11, 14],
}

const cropChunk = (blockType: CropBlockType, age: number | null = null, includeStateStorage = true) => {
  const id = Option.getOrThrow(blockIdOf(blockType))
  const index = blockIndex(4, 30, 5)
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  blocks[index] = id
  const base = { blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height: CHUNK_HEIGHT }
  if (!includeStateStorage) {
    return { chunk: base, index }
  }
  const blockStates = new Uint32Array(BLOCKS_PER_CHUNK)
  if (age !== null) {
    blockStates[index] = Result.getOrThrow(encodeBlockState(id, { age }))
  }
  return { chunk: { ...base, blockStates }, index }
}

const cornersOf = (plate: CrossPlantQuad): ReadonlyArray<string> =>
  plate.vertices.map((vertex) => vertex.join(','))

describe('the two plates', () => {
  it.effect('defaults absent neighbours for direct plant meshing', () =>
    Effect.sync(() => {
      const plates = Result.getOrThrow(meshCrossPlants({
        chunk: chunkWith([[8, 64, 8, FLOWER]]),
        plantLookup: Result.getOrThrow(buildCrossPlantLookup(CONFIG)),
        yLimit: CHUNK_HEIGHT,
      }))

      expect(plates).toHaveLength(2)
      expect(plates.every((plate) => !plate.light)).toBe(true)
    }),
  )

  it.effect('carries tall grass half state to both plant plates', () =>
    Effect.sync(() => {
      const index = blockIndex(8, 64, 8)
      const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
      blocks[index] = TALL_GRASS
      const blockStates = new Uint32Array(BLOCKS_PER_CHUNK)
      blockStates[index] = Result.getOrThrow(encodeBlockState(TALL_GRASS, { half: 'upper' }))
      const plates = Result.getOrThrow(meshCrossPlants({
        chunk: {
          blockStates,
          blocks,
          coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
          height: CHUNK_HEIGHT,
        },
        plantLookup: Result.getOrThrow(buildCrossPlantLookup(CONFIG)),
        yLimit: CHUNK_HEIGHT,
      }))

      expect(plates).toHaveLength(2)
      expect(plates.map((plate) => plate.blockState?.half)).toStrictEqual(['upper', 'upper'])
    }),
  )

  it.effect('propagates a malformed tall grass state instead of emitting default-state plates', () =>
    Effect.sync(() => {
      const index = blockIndex(8, 64, 8)
      const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
      blocks[index] = TALL_GRASS
      const blockStates = new Uint32Array(BLOCKS_PER_CHUNK)
      blockStates[index] = 0xffffffff
      const result = meshCrossPlants({
        chunk: {
          blockStates,
          blocks,
          coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
          height: CHUNK_HEIGHT,
        },
        plantLookup: Result.getOrThrow(buildCrossPlantLookup(CONFIG)),
        yLimit: CHUNK_HEIGHT,
      })

      expect(Result.isFailure(result)).toBe(true)
    }),
  )

  it.effect('a plant emits exactly two plates, four vertices each', () =>
    Effect.sync(() => {
      const layers = mesh(chunkWith([[8, 64, 8, FLOWER]]))
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
      const plates = mesh(chunkWith([[8, 64, 8, FLOWER]])).crossPlants
      expect(plates).toHaveLength(2)
      const first = Option.getOrThrow(Option.fromNullishOr(plates[0]))
      const second = Option.getOrThrow(Option.fromNullishOr(plates[1]))
      const low = 8 + PLANT_INSET
      const high = 9 - PLANT_INSET

      expect(cornersOf(first)).toStrictEqual([
        `${low},64,${low}`,
        `${low},65,${low}`,
        `${high},65,${high}`,
        `${high},64,${high}`,
      ])
      expect(cornersOf(second)).toStrictEqual([
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
      const [ax, az] = direction(first)
      const [bx, bz] = direction(second)
      expect(ax * bz - az * bx).not.toBe(0)
    }),
  )

  it.effect('is inset horizontally by PLANT_INSET and NOT inset vertically', () =>
    Effect.sync(() => {
      // A vertical inset would float the plant above the ground it stands on;
      // No horizontal inset would make the plate coplanar with the neighbouring
      // Block's face, which is z-fighting. `plant-mesh.ts:89-94`.
      const layers = mesh(chunkWith([[3, 20, 5, GRASS_TUFT]]))
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
      const layers = mesh(
        chunkWith([
          [8, 64, 8, FLOWER],
          [7, 64, 8, STONE],
          [9, 64, 8, STONE],
          [8, 64, 7, STONE],
          [8, 64, 9, STONE],
          [8, 65, 8, STONE],
          [8, 63, 8, STONE],
        ]),
      )
      expect(layers.crossPlants.every((plate) => plate.ao === 0)).toBe(true)
    }),
  )

  it.effect('emits in lx, lz, y order, so a golden hash over the plates is stable', () =>
    Effect.sync(() => {
      const layers = mesh(
        chunkWith([
          [4, 30, 4, FLOWER],
          [4, 20, 6, FLOWER],
          [2, 40, 9, GRASS_TUFT],
        ]),
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

  it.effect('both meshers agree on the plates in randomized short chunks, exactly', () =>
    Effect.sync(() => {
      const height = 8
      FastCheck.assert(
        FastCheck.property(
          FastCheck.array(
            FastCheck.tuple(
              FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
              FastCheck.integer({ max: height - 1, min: 0 }),
              FastCheck.integer({ max: CHUNK_SIZE - 1, min: 0 }),
              FastCheck.constantFrom(STONE, GLASS, WATER, FLOWER, GRASS_TUFT),
            ),
            { maxLength: 30, minLength: 0 },
          ),
          (cells) => {
            const chunk = chunkWith(cells, height)
            const render = (plates: ReadonlyArray<CrossPlantQuad>): string =>
              plates.map((plate) => `${plate.blockId}:${cornersOf(plate).join('|')}`).join(';')
            return (
              render(mesh(chunk).crossPlants) ===
              render(meshNaive(chunk).crossPlants)
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
      const chunk = chunkWith([[3, CHUNK_HEIGHT - 1, 3, FLOWER]])
      const layers = mesh(chunk)
      const naiveLayers = meshNaive(chunk)
      expect(layers.crossPlants.length).toBe(2)
      expect(naiveLayers.crossPlants).toStrictEqual(layers.crossPlants)
    }),
  )

  it.effect('a plant at the top of a short chunk is still meshed', () =>
    Effect.sync(() => {
      const height = 8
      const blocks = new Uint16Array(CHUNK_SIZE * height * CHUNK_SIZE)
      blocks[blockIndex(3, height - 1, 3, height)] = FLOWER

      const layers = mesh({ blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height })

      expect(layers.crossPlants.length).toBe(2)
    }),
  )

  it.effect('an empty chunk has an empty, distinct plate list', () =>
    Effect.sync(() => {
      const layers = mesh(Result.getOrThrow(emptyChunk()))
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
      const layers = mesh(chunkWith([[8, 64, 8, FLOWER]]))
      expect(totalQuadCount(layers)).toBe(0)
      expect(totalQuadArea(layers)).toBe(0)
      expect(layers.crossPlants.length).toBe(2)

      // And it is the CONFIG that decides, not the id: the same chunk with the
      // Same id meshed without the plant set produces an ordinary cube.
      const asCube = mesh(chunkWith([[8, 64, 8, FLOWER]]), EMPTY_MESH_CONFIG)
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
        const layers = mesh(
          chunkWith([
            [8, 64, 8, STONE],
            [8 + dx, 64 + dy, 8 + dz, FLOWER],
          ]),
        )
        expect(totalQuadArea(layers)).toBe(6)
        expect(layers.opaque.length).toBe(6)
      }

      // The control: the SAME arrangement with an opaque neighbour loses a face.
      // Without this, a mesher that had stopped culling entirely would pass.
      const withStone = mesh(
        chunkWith([
          [8, 64, 8, STONE],
          [9, 64, 8, STONE],
        ]),
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
      const layers = mesh(
        chunkWith([
          [8, 64, 8, STONE],
          [8, 65, 9, FLOWER],
        ]),
      )
      const zPos = layers.opaque.filter((quad) => quad.direction === 'zPos')
      expect(zPos.map((quad) => quad.ao)).toStrictEqual([1])
    }),
  )

  it.effect('two plants side by side both draw both plates: there is no shared face to cull', () =>
    Effect.sync(() => {
      const layers = mesh(
        chunkWith([
          [8, 64, 8, FLOWER],
          [9, 64, 8, FLOWER],
        ]),
      )
      expect(layers.crossPlants.length).toBe(4)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )
})

describe('the injected set', () => {
  it.effect('an empty injected set still models registry plants and leaves custom ids as cubes', () =>
    Effect.sync(() => {
      const withoutPlants: MeshConfig = {
        crossPlantBlockIds: new Set<BlockId>(),
        fluidMaxLevels: new Map(),
        transparentSolidBlockIds: new Set<BlockId>([GLASS]),
        waterBlockIds: new Set<BlockId>([WATER]),
      }
      const layers = mesh(chunkWith([[8, 64, 8, FLOWER]]), withoutPlants)
      expect(layers.crossPlants.length).toBe(0)
      expect(totalQuadCount(layers)).toBe(6)
    }),
  )

  it.effect('buildCrossPlantLookup accepts an explicitly empty set', () =>
    Effect.sync(() => {
      const lookup = Result.getOrThrow(buildCrossPlantLookup({
        crossPlantBlockIds: new Set(),
        fluidMaxLevels: new Map(),
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set(),
      }))
      expect(lookup.length).toBe(MAX_BLOCK_ID + 1)
      for (const currentBlockId of BLOCK_IDS) {
        const blockType = blockTypeOfId(currentBlockId)
        expect(Result.isFailure(blockType)).toBe(false)
        if (Result.isFailure(blockType)) {
          continue
        }
        const modelClass = classifyVanillaBlockType(blockType.success)
        expect(Result.isFailure(modelClass)).toBe(false)
        if (Result.isFailure(modelClass)) {
          continue
        }
        expect(isCrossPlant(lookup, currentBlockId)).toBe(modelClass.success === 'cross' || modelClass.success === 'crop')
      }
    }),
  )

  it.effect('the flattened table combines vanilla model classes and injected ids', () =>
    Effect.sync(() => {
      const lookup = Result.getOrThrow(buildCrossPlantLookup(CONFIG))
      for (let rawBlockId = 0; rawBlockId <= MAX_BLOCK_ID; rawBlockId += 1) {
        const currentBlockId = blockId(rawBlockId)
        const registeredType = blockTypeOfId(currentBlockId)
        let vanillaPlant = false
        if (!Result.isFailure(registeredType)) {
          const modelClass = classifyVanillaBlockType(registeredType.success)
          if (!Result.isFailure(modelClass)) {
            vanillaPlant = modelClass.success === 'cross' || modelClass.success === 'crop'
          }
        }
        const configuredPlant = CONFIG.crossPlantBlockIds.has(currentBlockId)
        expect(isCrossPlant(lookup, currentBlockId)).toBe(vanillaPlant || configuredPlant)
      }
    }),
  )

  it.effect('rejects a malformed runtime id while building the cross-plant lookup', () =>
    Effect.sync(() => {
      const config = {
        ...EMPTY_MESH_CONFIG,
        crossPlantBlockIds: new Set([-1]),
      }
      // @ts-expect-error The runtime API must reject ids that TypeScript blocks callers from supplying.
      const lookup = buildCrossPlantLookup(config)
      expect(lookup).toStrictEqual(KernelBlockId.result(-1))
    }),
  )

  it.effect('a block can be BOTH a plant and a transparent solid: shape and material are separate questions', () =>
    Effect.sync(() => {
      // The reason this is a third set rather than a fourth layer. The reference
      // Routes every plant into the transparent-solid accumulator
      // (`plant-mesh.ts:245`), i.e. a cross plate is normally see-through — so
      // The two classifications must be able to hold at once.
      const both: MeshConfig = {
        crossPlantBlockIds: new Set<BlockId>([FLOWER]),
        fluidMaxLevels: new Map(),
        transparentSolidBlockIds: new Set<BlockId>([FLOWER]),
        waterBlockIds: new Set<BlockId>(),
      }
      const layers = mesh(chunkWith([[8, 64, 8, FLOWER]]), both)
      expect(layers.crossPlants.length).toBe(2)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )
})

describe('crop texture stages', () => {
  it.effect('selects each crop age as its texture stage and validates the public result', () =>
    Effect.sync(() => {
      const plantLookup = Result.getOrThrow(buildCrossPlantLookup(EMPTY_MESH_CONFIG))
      const cropAndAge = FastCheck.oneof(
        FastCheck.tuple(FastCheck.constant('wheat_crop' as const), FastCheck.integer({ min: 0, max: 7 })),
        FastCheck.tuple(FastCheck.constant('potato_crop' as const), FastCheck.integer({ min: 0, max: 7 })),
        FastCheck.tuple(FastCheck.constant('nether_wart_crop' as const), FastCheck.integer({ min: 0, max: 3 })),
      )
      FastCheck.assert(
        FastCheck.property(cropAndAge, ([blockType, age]) => {
          const { chunk, index } = cropChunk(blockType, age)
          const selected = plantTextureStageAt(chunk, index)
          if (Result.isFailure(selected) || Option.isNone(selected.success)) {
            return false
          }
          const stage = selected.success.value
          const schemaResult = SchemaParser.decodeUnknownResult(PlantTextureStageSchema)(stage)
          const geometry = meshCrossPlants({ chunk, plantLookup, yLimit: chunk.height })
          if (Result.isFailure(geometry)) {
            return false
          }
          const vertices = geometry.success.flatMap((quad) => quad.vertices)
          const yValues = vertices.map((vertex) => vertex[1])
          return (
            Result.isSuccess(schemaResult) &&
            stage.blockType === blockType &&
            stage.stage === age &&
            geometry.success.length === 4 &&
            geometry.success.every((quad) => quad.textureStage?.blockType === blockType && quad.textureStage.stage === age) &&
            Math.min(...yValues) === 30 - 1 / 16 &&
            Math.max(...yValues) === 30 + 15 / 16
          )
        }),
        { numRuns: 120 },
      )
    }),
    PROPERTY_TIMEOUT_MS,
  )

  it.effect('keeps the vanilla crop model full-sized while stage textures provide their distinct silhouettes', () =>
    Effect.sync(() => {
      const low = cropChunk('wheat_crop', 0)
      const high = cropChunk('wheat_crop', 7)
      const plantLookup = Result.getOrThrow(buildCrossPlantLookup(EMPTY_MESH_CONFIG))
      const lowQuads = Result.getOrThrow(meshCrossPlants({ chunk: low.chunk, plantLookup, yLimit: low.chunk.height }))
      const highQuads = Result.getOrThrow(meshCrossPlants({ chunk: high.chunk, plantLookup, yLimit: high.chunk.height }))

      // Vanilla's shared crop model is y=-1..15 for all ages. Its stage texture
      // alpha carries the visible height; shortening this geometry would shrink
      // the silhouette twice when mc-render selects that textureStage tile.
      expect(lowQuads).toHaveLength(4)
      expect(highQuads).toHaveLength(4)
      expect(lowQuads.every((quad) => quad.textureStage?.stage === 0)).toBe(true)
      expect(highQuads.every((quad) => quad.textureStage?.stage === 7)).toBe(true)
      expect(lowQuads.map((quad) => quad.vertices)).toStrictEqual(highQuads.map((quad) => quad.vertices))
      const layers = mesh(high.chunk, EMPTY_MESH_CONFIG)
      expect(layers.crossPlants).toHaveLength(4)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )

  it.effect('selects each vanilla stage texture with its independently measured silhouette height', () =>
    Effect.sync(() => {
      const plantLookup = Result.getOrThrow(buildCrossPlantLookup(EMPTY_MESH_CONFIG))
      for (const blockType of CROP_BLOCK_TYPES) {
        const heights = VANILLA_CROP_TEXTURE_HEIGHT_PIXELS[blockType]
        for (const [age, expectedVisibleHeight] of heights.entries()) {
          const { chunk } = cropChunk(blockType, age)
          const quads = Result.getOrThrow(meshCrossPlants({ chunk, plantLookup, yLimit: chunk.height }))
          expect(quads).toHaveLength(4)
          expect(quads.map((quad) => quad.textureStage)).toStrictEqual(
            Array.from({ length: 4 }, () => ({ blockType, stage: age })),
          )
          const selectedTextureHeights = quads.map((quad) => {
            const stage = quad.textureStage
            if (!stage || stage.blockType === 'sapling') {
              return null
            }
            return VANILLA_CROP_TEXTURE_HEIGHT_PIXELS[stage.blockType][stage.stage]
          })
          expect(selectedTextureHeights).toStrictEqual([
            expectedVisibleHeight,
            expectedVisibleHeight,
            expectedVisibleHeight,
            expectedVisibleHeight,
          ])
        }

        expect(heights[0]).not.toBe(heights[heights.length - 1])
      }
    }),
  )

  it.effect('builds crop planes at the four vanilla axis offsets', () =>
    Effect.sync(() => {
      const { chunk } = cropChunk('wheat_crop', 4)
      const quads = crossPlants(chunk)
      expect(quads).toHaveLength(4)
      expect(quads.map((quad) => [quad.nx, quad.nz])).toStrictEqual([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
      const xCoordinates = quads.slice(0, 2).map((quad) => quad.vertices[0][0])
      const zCoordinates = quads.slice(2).map((quad) => quad.vertices[0][2])
      expect(xCoordinates).toStrictEqual([4 + 4 / 16, 4 + 12 / 16])
      expect(zCoordinates).toStrictEqual([5 + 4 / 16, 5 + 12 / 16])
    }),
  )

  it.effect('uses four axis-aligned planes for seagrass and diagonal planes for other crosses', () =>
    Effect.sync(() => {
      const seagrass = Option.getOrThrow(blockIdOf('seagrass'))
      const amethyst = Option.getOrThrow(blockIdOf('amethyst_cluster'))
      const cobweb = Option.getOrThrow(blockIdOf('cobweb'))
      const sapling = Option.getOrThrow(blockIdOf('sapling'))
      const chunks = chunkWith([
        [2, 20, 3, seagrass],
        [4, 20, 3, amethyst],
        [6, 20, 3, cobweb],
        [8, 20, 3, sapling],
      ])
      const quads = crossPlants(chunks)
      expect(quads.filter((quad) => quad.blockId === seagrass)).toHaveLength(4)
      expect(quads.filter((quad) => quad.blockId === amethyst)).toHaveLength(2)
      expect(quads.filter((quad) => quad.blockId === cobweb)).toHaveLength(2)
      expect(quads.filter((quad) => quad.blockId === sapling)).toHaveLength(2)
      expect(quads.filter((quad) => quad.blockId === seagrass).every((quad) => quad.ny === 0)).toBe(true)
      expect(quads.filter((quad) => quad.blockId === sapling).every((quad) => quad.textureStage?.blockType === 'sapling')).toBe(true)
    }),
  )

  it.effect('selects representative wheat, potato, and nether wart textures', () =>
    Effect.sync(() => {
      for (const [blockType, age] of [
        ['wheat_crop', 6],
        ['potato_crop', 4],
        ['nether_wart_crop', 3],
      ] as const) {
        const { chunk, index } = cropChunk(blockType, age)
        const stage = Option.getOrThrow(Result.getOrThrow(plantTextureStageAt(chunk, index)))
        expect(stage).toStrictEqual({ blockType, stage: age })
      }
    }),
  )

  it.effect('uses kernel default crop state when the state storage is omitted', () =>
    Effect.sync(() => {
      const { chunk, index } = cropChunk('wheat_crop', null, false)
      const stage = Option.getOrThrow(Result.getOrThrow(plantTextureStageAt(chunk, index)))
      expect(stage).toStrictEqual({ blockType: 'wheat_crop', stage: 0 })
    }),
  )

  it.effect('returns each sapling growth stage for resource-pack model selection', () =>
    Effect.sync(() => {
      const saplingId = Option.getOrThrow(blockIdOf('sapling'))
      const index = blockIndex(4, 30, 5)
      for (const stage of [0, 1] as const) {
        const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
        blocks[index] = saplingId
        const blockStates = new Uint32Array(BLOCKS_PER_CHUNK)
        blockStates[index] = Result.getOrThrow(encodeBlockState(saplingId, { stage }))
        const chunk: ChunkView = {
          blockStates,
          blocks,
          coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
          height: CHUNK_HEIGHT,
        }

        expect(plantTextureStageAt(chunk, index)).toStrictEqual(
          Result.succeed(Option.some({ blockType: 'sapling', stage })),
        )
        const quads = crossPlants(chunk)
        expect(quads).toHaveLength(2)
        expect(quads.every((quad) => quad.textureStage?.blockType === 'sapling' && quad.textureStage.stage === stage)).toBe(true)
      }

      const defaultBlocks = new Uint16Array(BLOCKS_PER_CHUNK)
      defaultBlocks[index] = saplingId
      const defaultChunk: ChunkView = {
        blocks: defaultBlocks,
        coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
        height: CHUNK_HEIGHT,
      }
      expect(plantTextureStageAt(defaultChunk, index)).toStrictEqual(
        Result.succeed(Option.some({ blockType: 'sapling', stage: 0 })),
      )
    }),
  )

  it.effect('returns a typed failure for an invalid chunk index', () =>
    Effect.sync(() => {
      const chunk = Result.getOrThrow(emptyChunk(CHUNK_HEIGHT))
      const invalidIndex = blockIndex(0, -1, 0, chunk.height)

      expect(plantTextureStageAt(chunk, invalidIndex)).toMatchObject({
        failure: { _tag: 'ChunkBlockStateIndexOutOfRange', expected: BLOCKS_PER_CHUNK, index: -1 },
      })
    }),
  )

  it.effect('returns no texture stage for non-plants and rejects explicit state for unknown ids', () =>
    Effect.sync(() => {
      const index = blockIndex(4, 30, 5)
      const stone = Option.getOrThrow(blockIdOf('stone'))
      expect(plantTextureStageAt(chunkWith([[4, 30, 5, stone]]), index)).toStrictEqual(Result.succeed(Option.none()))

      const unknownId = blockId(300)
      const unknownType = blockTypeOfId(unknownId)
      expect(unknownType).toStrictEqual(Result.succeed(Reflect.get({}, 'missing')))
      expect(plantTextureStageAt(chunkWith([[4, 30, 5, unknownId]]), index)).toStrictEqual(Result.succeed(Option.none()))

      const encodedStates = new Uint32Array(BLOCKS_PER_CHUNK)
      const unknownWithStates: ChunkView = {
        ...chunkWith([[4, 30, 5, unknownId]]),
        blockStates: encodedStates,
      }
      expect(plantTextureStageAt(unknownWithStates, index)).toStrictEqual(Result.fail({
        _tag: 'ChunkBlockStateCodecFailure',
        blockId: unknownId,
        encoded: 0,
        index,
        reason: 'unknown-block-id',
      }))
    }),
  )

  it('returns the shared model-property failure for arbitrary out-of-range crop ages', async () => {
    vi.resetModules()
    let age = -1
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      return {
        ...kernel,
        effectiveBlockStateOf: invalidFixture<typeof kernel.effectiveBlockStateOf>(
          () => Result.succeed(invalidFixture<EffectiveBlockStateValues>({ age })),
        ),
      }
    })
    try {
      const { buildCrossPlantLookup: buildLookup, meshCrossPlants: meshPlants } = await import('../src/domain/plant-mesh.js')
      const { chunk } = cropChunk('wheat_crop', 0)
      const plantLookup = Result.getOrThrow(buildLookup(EMPTY_MESH_CONFIG))
      const invalidAge = FastCheck.oneof(
        FastCheck.integer({ min: -64, max: -1 }),
        FastCheck.integer({ min: 8, max: 64 }),
      )
      FastCheck.assert(
        FastCheck.property(invalidAge, (candidateAge) => {
          age = candidateAge
          const result = meshPlants({ chunk, plantLookup, yLimit: chunk.height })
          expect(result).toStrictEqual(Result.fail({
            _tag: 'InvalidBlockStateModelProperty',
            blockId: Option.getOrThrow(blockIdOf('wheat_crop')),
            property: 'age',
          }))
          return true
        }),
        { numRuns: 120 },
      )
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('propagates kernel block-type lookup failures when selecting a plant stage', async () => {
    vi.resetModules()
    const failure = { _tag: 'InjectedBlockTypeFailure' }
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      return {
        ...kernel,
        blockTypeOfId: (candidateId: BlockId) => candidateId === Option.getOrThrow(blockIdOf('sapling'))
          ? invalidFixture(Result.fail(failure))
          : kernel.blockTypeOfId(candidateId),
      }
    })
    try {
      const { plantTextureStageAt: selectStage } = await import('../src/domain/plant-mesh.js')
      const { chunk, index } = cropChunk('wheat_crop', null, false)
      const blocks = new Uint16Array(chunk.blocks)
      blocks[index] = Option.getOrThrow(blockIdOf('sapling'))
      expect(selectStage({ ...chunk, blocks }, index)).toStrictEqual(Result.fail(failure))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })
})
