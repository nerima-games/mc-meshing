/**
 * Cross-plate plant geometry: the two diagonal panes a flower or a tuft of grass
 * is drawn as.
 *
 * Ported from the reference implementation's
 * `packages/rendering/infrastructure/meshing/plant-mesh.ts` — the CROSS-PLATE
 * part of it (`addCrossPlant`, :79-98, and the id list at :18-28). What is
 * deliberately not ported is at the bottom of this comment.
 *
 * ---------------------------------------------------------------------------
 * A cross plate is not a block face, and that is the whole design problem
 * ---------------------------------------------------------------------------
 *
 * Every other thing this repository emits is a `Quad`: an origin cell, a face
 * direction, and two integer extents. That representation is not a limitation,
 * it is the point — it is what lets the greedy merge exist, what lets
 * `simplifyMesh` snap a box onto a grid, and what lets a test expand a quad back
 * into the unit block-faces it claims.
 *
 * A cross plate fits none of it:
 *
 *  - its plane is DIAGONAL, so it has no `FaceDirection`. Its normal is not
 *    axis-aligned.
 *  - its corners are FRACTIONAL: inset by `PLANT_INSET` from the cell's walls,
 *    so the plant does not z-fight with the block it stands on.
 *  - it covers NO block face, so it contributes nothing to `totalQuadArea`, and
 *    the coverage property that the merge rests on has nothing to say about it.
 *  - two of them never merge. There is no rectangle to grow.
 *
 * So `CrossPlantQuad` carries four explicit vertices, and it travels in its own
 * list rather than in one of the three `Quad` layers. Forcing it into `Quad`
 * would mean either giving `Quad` a fractional, direction-less mode that every
 * consumer has to branch on — including `simplifyMesh`, which would then be
 * snapping something that has no extent to snap — or lying about its geometry.
 *
 * plan.md §3.3 specifies the output as `{opaque, water, transparentSolid}`, so
 * a fourth list IS a deviation from the stated API and is recorded as one; see
 * docs/design-notes.md M-11. The alternative is not "no deviation", it is a
 * deviation hidden inside `Quad`.
 *
 * ---------------------------------------------------------------------------
 * Which blocks are plants is INJECTED, for the reason §3.2 already settled
 * ---------------------------------------------------------------------------
 *
 * The reference names them: `blockTypeToIndex('DANDELION')`, `'POPPY'`,
 * `'TALL_GRASS'` and six more (`plant-mesh.ts:18-28`). This repository has no
 * block registry on purpose — docs/responsibility.md §3.2 — so the set arrives
 * through `MeshConfig` exactly as `waterBlockIds` and `transparentSolidBlockIds`
 * do, and for the same three reasons: no extra edge in the dependency graph,
 * tests may use any ids, and a resource pack cannot break meshing.
 *
 * It is a native `Set` and is flattened into a byte table before the inner loop,
 * for the reason `domain/opacity.ts` gives at length. It is consulted on the
 * ~400k calls/chunk path — once for the cell and once for its neighbour — so
 * it is not a place for a hash lookup.
 *
 * ---------------------------------------------------------------------------
 * What a plant does to the six solid passes: NOTHING, in both directions
 * ---------------------------------------------------------------------------
 *
 * 1. A plant block emits NO cube faces. The reference guards every one of the
 *    six passes with `!isPlantMeshBlockId(blockId)`
 *    (`greedy-meshing-algorithms.ts:40, 79, 118, 157, 196, 235`). Without it a
 *    flower would be drawn as a solid cube AND as a cross.
 * 2. A plant block HIDES NOTHING. This is where the port diverges, deliberately.
 *    The reference's `isSolidFaceExposed` (`greedy-meshing-fluid-state.ts:145-157`)
 *    returns `true` only for an AIR neighbour or a transparent-solid one, and
 *    plants are in neither set — so in the reference a flower standing beside a
 *    stone block CULLS that block's face, and you see through the wall past the
 *    flower. That is a bug, not a decision: nothing in the reference states it,
 *    no test covers it, and it is invisible on ordinary terrain only because a
 *    plant's horizontal neighbours are almost always air.
 *
 *    Here a cross-plant neighbour is treated exactly as air by `isFaceExposed`.
 *    A two-triangle diagonal pane occupying a tenth of a cell cannot occlude
 *    anything, so this is the semantically correct answer and not a preference.
 *    Recorded as a deviation in docs/design-notes.md M-11 and pinned by
 *    `test/plant-mesh.test.ts`.
 */
import {
  BLOCK_IDS,
  BlockId as KernelBlockId,
  blockIdOf,
  blockTypeOfId,
  type BlockType,
} from '@nerima-games/mc-kernel'
import type { BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel/domain/block-registry'
import { Option, Result, SchemaIssue, SchemaParser } from 'effect'
import { blockIdAt, type BlockId, MAX_BLOCK_ID } from './block-data.js'
import {
  CHUNK_SIZE,
  type ChunkBlockIndex,
  type ChunkNeighbours,
  type ChunkView,
  blockIndex,
  blockStateAt,
  getBlock,
  type ChunkViewFailure,
} from './chunk-view.js'
import { PlantTextureStageSchema, type CrossPlantQuad, type PlantTextureStage } from './plant-types.js'
import { type MeshConfig } from './opacity.js'
import { quadLightAt } from './light-sampling.js'
import { classifyVanillaBlockType, type UnclassifiedVanillaBlockType } from './vanilla-block-model.js'
import type { InvalidBlockStateModelPropertyFailure } from './special-types.js'

export { PlantTextureStageSchema } from './plant-types.js'
export type { CrossPlantQuad, PlantTextureStage, PlantVertex } from './plant-types.js'

type PlantTextureBlockType = Extract<BlockType, 'sapling' | 'wheat_crop' | 'potato_crop' | 'nether_wart_crop'>
type CropTextureBlockType = Exclude<PlantTextureBlockType, 'sapling'>

const isPlantTextureBlockType = (blockType: BlockType | null | undefined): blockType is PlantTextureBlockType =>
  blockType === 'sapling' || blockType === 'wheat_crop' || blockType === 'potato_crop' || blockType === 'nether_wart_crop'

const isCropTextureBlockType = (blockType: BlockType | null | undefined): blockType is CropTextureBlockType =>
  blockType === 'wheat_crop' || blockType === 'potato_crop' || blockType === 'nether_wart_crop'

const TALL_GRASS_BLOCK_ID = blockIdOf('tall_grass')

// Registry metadata is immutable, but a chunk can contain many cells with the same plant id.
const VANILLA_BLOCK_TYPE_CACHE = new Map<BlockId, BlockType | null>()

const cacheVanillaBlockType = (
  blockId: BlockId,
): Result.Result<null, BlockRegistryResolutionFailure | UnclassifiedVanillaBlockType> => {
  const registeredType = blockTypeOfId(blockId)
  if (Result.isFailure(registeredType)) {
    return Result.fail(registeredType.failure)
  }
  if (typeof registeredType.success === 'undefined') {
    VANILLA_BLOCK_TYPE_CACHE.set(blockId, null)
    return Result.succeed(null)
  }
  const modelClass = classifyVanillaBlockType(registeredType.success)
  if (Result.isFailure(modelClass)) {
    return Result.fail(modelClass.failure)
  }
  VANILLA_BLOCK_TYPE_CACHE.set(blockId, registeredType.success)
  return Result.succeed(null)
}

export type PlantTextureStageFailure =
  | BlockRegistryResolutionFailure
  | ChunkViewFailure
  | {
      readonly _tag: 'InvalidPlantTextureStage'
      readonly stage: unknown
      readonly blockId: BlockId
      readonly blockType: PlantTextureBlockType
      readonly issue: SchemaIssue.Issue
    }

export type PlantMeshFailure =
  | BlockRegistryResolutionFailure
  | ChunkViewFailure
  | UnclassifiedVanillaBlockType
  | InvalidBlockStateModelPropertyFailure

const plantTextureStageOf = (
  blockId: BlockId,
  blockType: PlantTextureBlockType,
  stage: number | undefined,
): Result.Result<PlantTextureStage, PlantTextureStageFailure> =>
  Result.mapError(
    SchemaParser.decodeUnknownResult(PlantTextureStageSchema)({ blockType, stage }),
    (issue) => ({ _tag: 'InvalidPlantTextureStage', stage, blockId, blockType, issue }),
  )

const modelPropertyFailureOf = (
  failure: PlantTextureStageFailure,
  blockType: PlantTextureBlockType,
): PlantMeshFailure => {
  const { _tag: failureTag } = failure
  if (failureTag !== 'InvalidPlantTextureStage') {
    return failure
  }
  return {
    _tag: 'InvalidBlockStateModelProperty',
    blockId: failure.blockId,
    property: blockType === 'sapling' ? 'stage' : 'age',
  }
}

/** Select the texture stage for a crop or sapling at a chunk storage index. */
export const plantTextureStageAt = (
  chunk: ChunkView,
  index: ChunkBlockIndex,
): Result.Result<Option.Option<PlantTextureStage>, PlantTextureStageFailure> => {
  const state = blockStateAt(chunk, index)
  if (Result.isFailure(state)) {
    return Result.fail(state.failure)
  }
  const blockId = blockIdAt(chunk.blocks, index)
  const blockType = blockTypeOfId(blockId)
  if (Result.isFailure(blockType)) {
    return Result.fail(blockType.failure)
  }
  switch (blockType.success) {
    case 'sapling':
      return Result.map(plantTextureStageOf(blockId, blockType.success, state.success.stage), Option.some)
    case 'wheat_crop':
    case 'potato_crop':
    case 'nether_wart_crop': {
      return Result.map(
        plantTextureStageOf(blockId, blockType.success, state.success.age),
        Option.some,
      )
    }
    default:
      return Result.succeed(Option.none())
  }
}

/**
 * How far each plate is pulled in from the cell's four vertical walls.
 *
 * `0.1` — the reference's `PLANT_INSET` (`plant-mesh.ts:13`), transcribed. The
 * inset is what stops the plate from being coplanar with the neighbouring
 * block's face, which is z-fighting: two surfaces at the same depth, flickering
 * as the camera moves.
 *
 * TRANSCRIBED, NOT JUSTIFIED. The reference does not say why a tenth of a block
 * rather than the `1/16` it uses for its own thin blocks (`THIN_BLOCK_INSET`,
 * :14), and nothing here has measured it. What it buys is a function of the
 * renderer's depth precision at the draw distance, and this repository cannot
 * see a renderer. See docs/design-notes.md M-11.
 */
export const PLANT_INSET = 0.1

/**
 * One full cell, in block-local units. Each plate's far edge is inset from
 * `lx`/`lz` plus this, and its top runs from `y` to `y` plus this.
 */
const CELL_SIZE = 1

/**
 * Flatten the cross-plant id set into a `MAX_BLOCK_ID + 1`-entry byte table,
 * `1` meaning "this id is a cross plant".
 *
 * The same device as `buildLayerLookup`, kept separate rather than folded into
 * it. Folding would mean giving that table a fourth value that is not a
 * `MeshLayer`, which breaks its contract — `layerOfBlockId` returns a
 * `MeshLayer` and `test/public-api.test.ts` checks the two agree over every
 * representable id — in exchange for one byte-indexed read. The read is the
 * cheap thing here; the contract is not.
 */
/** `MAX_BLOCK_ID` is inclusive, so the table needs one more slot than that. */
const TABLE_SIZE_OFFSET = 1

/**
 * Size of a byte-indexed table covering every representable block id. The
 * same fact `domain/opacity.ts`'s `buildLayerLookup` needs, restated here
 * rather than imported — the two tables are kept deliberately separate (see
 * the comment above), and a shared size constant would be a needless coupling
 * for one arithmetic fact.
 */
const BLOCK_ID_TABLE_SIZE = MAX_BLOCK_ID + TABLE_SIZE_OFFSET

/** Marker written into the table for "this id is a cross plant". */
const CROSS_PLANT_MARKER = 1

type KernelBlockIdFailure = ReturnType<typeof KernelBlockId.result> extends Result.Result<
  BlockId,
  infer Failure
>
  ? Failure
  : never

export type CrossPlantLookupFailure = KernelBlockIdFailure | BlockRegistryResolutionFailure | UnclassifiedVanillaBlockType

export const buildCrossPlantLookup = (config: MeshConfig): Result.Result<Uint8Array, CrossPlantLookupFailure> => {
  for (const blockId of config.crossPlantBlockIds) {
    const validated = KernelBlockId.result(blockId)
    if (Result.isFailure(validated)) {
      return Result.fail(validated.failure)
    }
  }
  const lookup = new Uint8Array(BLOCK_ID_TABLE_SIZE)
  for (const blockId of BLOCK_IDS) {
    const blockType = blockTypeOfId(blockId)
    if (Result.isFailure(blockType)) {
      return Result.fail(blockType.failure)
    }
    const modelClass = classifyVanillaBlockType(blockType.success)
    if (Result.isFailure(modelClass)) {
      return Result.fail(modelClass.failure)
    }
    if (modelClass.success === 'cross' || modelClass.success === 'crop') {
      lookup[blockId] = CROSS_PLANT_MARKER
    }
  }
  // Iterating the SET rather than every representable id, unlike `buildLayerLookup`. That
  // One has to visit every id because it must give every id an answer; this one
  // Defaults to "not a plant" and only the named ids differ.
  //
  // The input IDs are checked once before table construction because typed-array
  // writes outside the table are silently ignored. The meshing loop then reads
  // this validated table without repeating the check per cell.
  for (const blockId of config.crossPlantBlockIds) {
    lookup[blockId] = CROSS_PLANT_MARKER
  }
  return Result.succeed(lookup)
}

/** Is this id a cross plant, per the flattened table? */
export const isCrossPlant = (lookup: Uint8Array, blockId: BlockId): boolean =>
  lookup[blockId] === CROSS_PLANT_MARKER

/**
 * The two plates for one cell, in the reference's vertex order.
 *
 * Transcribed from `addCrossPlant` (`plant-mesh.ts:89-97`) with the world offset
 * dropped — the reference adds `offset.wx` / `offset.wz` to place the chunk in
 * the world, and docs/responsibility.md §3.3 keeps this repository chunk-local,
 * so mc-render applies the offset exactly as it already does for `Quad`.
 *
 * The two plates run on OPPOSITE diagonals: the first from the `(x0, z0)` corner
 * to `(x1, z1)`, the second from `(x1, z0)` to `(x0, z1)`. Getting both from the
 * same corner would draw two coplanar panes instead of a cross — a plant that
 * disappears when viewed from 90 degrees away, which no face count can see.
 *
 * Y is NOT inset: the plate runs the full height of the cell, `y` to `y + 1`
 * (:93-94). A plant inset vertically would float above the ground it stands on.
 */
/**
 * Every cross plate in the chunk, in `lx` then `lz` then `y` order.
 *
 * That is the reference's loop nesting (`addPlantMeshes`, `plant-mesh.ts:238-240`)
 * and it is also the order `meshChunkNaive` uses, which is convenient rather
 * than load-bearing: nothing merges here, so no ordering is forced by the
 * algorithm the way the six face passes' orders are (docs/design-notes.md M-4).
 * It is pinned by a test anyway, because a golden hash over a geometry buffer
 * does not care why an order is stable, only that it is.
 *
 * Bounded by `yLimit` like the face passes, and for the same reason: a plant is
 * a non-air block, so none can exist above the highest one. The reference caps
 * the same way (`Math.min(chunk.height, yLimit)`, :237).
 *
 * Neighbours are consulted only for injected corner lighting. Cross-plate
 * geometry itself is bounded to the chunk and does not participate in culling.
 */
/** Loop increment: visit each chunk-local coordinate exactly once. */
const LOOP_STEP = 1

/** Minimum value along a chunk-local coordinate axis. */
const AXIS_ORIGIN = 0

/** Chunk-local origin, the default lower bound for `meshCrossPlants`. */
const CHUNK_ORIGIN: readonly [number, number, number] = [AXIS_ORIGIN, AXIS_ORIGIN, AXIS_ORIGIN]

type CrossPlantBounds = {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

type CrossPlantOptions = {
  readonly bounds?: CrossPlantBounds
  readonly chunk: ChunkView
  readonly neighbours?: ChunkNeighbours
  readonly plantLookup: Uint8Array
  readonly yLimit: number
}

type PlantPlateInput = {
  readonly blockState: CrossPlantQuad['blockState']
  readonly blockId: BlockId
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly light: CrossPlantQuad['light']
  readonly textureStage?: PlantTextureStage
}

type CrossPlantContext = {
  readonly chunk: ChunkView
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly neighbours: ChunkNeighbours
  readonly plantLookup: Uint8Array
}

const crossPlantContextOf = ({
  bounds,
  chunk,
  neighbours,
  plantLookup,
  yLimit,
}: CrossPlantOptions): CrossPlantContext => {
  const resolvedBounds = bounds ?? { max: [CHUNK_SIZE, yLimit, CHUNK_SIZE], min: CHUNK_ORIGIN }
  const [minX, minY, minZ] = resolvedBounds.min
  const [maxX, maxBoundY, maxZ] = resolvedBounds.max
  return {
    chunk,
    maxX,
    maxY: Math.min(yLimit, maxBoundY),
    maxZ,
    minX,
    minY,
    minZ,
    neighbours: neighbours ?? {},
    plantLookup,
  }
}

const lightPropertiesOf = (light: CrossPlantQuad['light']): Pick<CrossPlantQuad, 'light'> => {
  if (light) {
    return { light }
  }
  return {}
}

const blockStatePropertiesOf = (blockState: CrossPlantQuad['blockState']): Pick<CrossPlantQuad, 'blockState'> => {
  if (typeof blockState !== 'undefined') {
    return { blockState }
  }
  return {}
}

const textureStagePropertiesOf = (textureStage: PlantTextureStage | undefined): Pick<CrossPlantQuad, 'textureStage'> => {
  if (typeof textureStage !== 'undefined') {
    return { textureStage }
  }
  return {}
}

const platesFor = ({ blockState, blockId, lx, y, lz, light, textureStage }: PlantPlateInput): ReadonlyArray<CrossPlantQuad> => {
  const x0 = lx + PLANT_INSET
  const x1 = lx + CELL_SIZE - PLANT_INSET
  const z0 = lz + PLANT_INSET
  const z1 = lz + CELL_SIZE - PLANT_INSET
  const y0 = y
  const y1 = y + CELL_SIZE
  return [
    {
      ao: 0,
      blockId,
      ...blockStatePropertiesOf(blockState),
      ...textureStagePropertiesOf(textureStage),
      nx: 0,
      ny: 0,
      nz: 1,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
    },
    {
      ao: 0,
      blockId,
      ...blockStatePropertiesOf(blockState),
      ...textureStagePropertiesOf(textureStage),
      nx: 1,
      ny: 0,
      nz: 0,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z1],
        [x0, y0, z1],
      ],
    },
  ]
}

const MODEL_PIXEL_SIZE = 16
const CROP_TOP_MODEL_PIXEL = 15
const CROP_BOTTOM_MODEL_PIXEL = -1
const PLANE_INSET_MODEL_PIXELS = 4
const PLANE_OPPOSITE_INSET_MODEL_PIXELS = MODEL_PIXEL_SIZE - PLANE_INSET_MODEL_PIXELS
const modelPixel = (value: number): number => value / MODEL_PIXEL_SIZE

const cropPlatesFor = ({ blockId, lx, y, lz, light, textureStage }: PlantPlateInput): ReadonlyArray<CrossPlantQuad> => {
  const y0 = y + modelPixel(CROP_BOTTOM_MODEL_PIXEL)
  const y1 = y + modelPixel(CROP_TOP_MODEL_PIXEL)
  const x0 = lx + modelPixel(PLANE_INSET_MODEL_PIXELS)
  const x1 = lx + modelPixel(PLANE_OPPOSITE_INSET_MODEL_PIXELS)
  const z0 = lz + modelPixel(PLANE_INSET_MODEL_PIXELS)
  const z1 = lz + modelPixel(PLANE_OPPOSITE_INSET_MODEL_PIXELS)
  return [
    {
      ao: 0,
      blockId,
      ...textureStagePropertiesOf(textureStage),
      nx: 1,
      ny: 0,
      nz: 0,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[x0, y0, lz], [x0, y1, lz], [x0, y1, lz + CELL_SIZE], [x0, y0, lz + CELL_SIZE]],
    },
    {
      ao: 0,
      blockId,
      ...textureStagePropertiesOf(textureStage),
      nx: -1,
      ny: 0,
      nz: 0,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[x1, y0, lz], [x1, y1, lz], [x1, y1, lz + CELL_SIZE], [x1, y0, lz + CELL_SIZE]],
    },
    {
      ao: 0,
      blockId,
      ...textureStagePropertiesOf(textureStage),
      nx: 0,
      ny: 0,
      nz: 1,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[lx, y0, z0], [lx, y1, z0], [lx + CELL_SIZE, y1, z0], [lx + CELL_SIZE, y0, z0]],
    },
    {
      ao: 0,
      blockId,
      ...textureStagePropertiesOf(textureStage),
      nx: 0,
      ny: 0,
      nz: -1,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[lx, y0, z1], [lx, y1, z1], [lx + CELL_SIZE, y1, z1], [lx + CELL_SIZE, y0, z1]],
    },
  ]
}

const seagrassPlatesFor = ({ blockId, lx, y, lz, light }: PlantPlateInput): ReadonlyArray<CrossPlantQuad> => {
  const x0 = lx + modelPixel(PLANE_INSET_MODEL_PIXELS)
  const x1 = lx + modelPixel(PLANE_OPPOSITE_INSET_MODEL_PIXELS)
  const z0 = lz + modelPixel(PLANE_INSET_MODEL_PIXELS)
  const z1 = lz + modelPixel(PLANE_OPPOSITE_INSET_MODEL_PIXELS)
  const y0 = y
  const y1 = y + CELL_SIZE
  return [
    {
      ao: 0,
      blockId,
      nx: 1,
      ny: 0,
      nz: 0,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[x0, y0, lz], [x0, y1, lz], [x0, y1, lz + CELL_SIZE], [x0, y0, lz + CELL_SIZE]],
    },
    {
      ao: 0,
      blockId,
      nx: -1,
      ny: 0,
      nz: 0,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[x1, y0, lz], [x1, y1, lz], [x1, y1, lz + CELL_SIZE], [x1, y0, lz + CELL_SIZE]],
    },
    {
      ao: 0,
      blockId,
      nx: 0,
      ny: 0,
      nz: 1,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[lx, y0, z0], [lx, y1, z0], [lx + CELL_SIZE, y1, z0], [lx + CELL_SIZE, y0, z0]],
    },
    {
      ao: 0,
      blockId,
      nx: 0,
      ny: 0,
      nz: -1,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [[lx, y0, z1], [lx, y1, z1], [lx + CELL_SIZE, y1, z1], [lx + CELL_SIZE, y0, z1]],
    },
  ]
}

export const meshCrossPlants = (
  options: CrossPlantOptions,
): Result.Result<ReadonlyArray<CrossPlantQuad>, PlantMeshFailure> => {
  const { chunk, maxX, maxY, maxZ, minX, minY, minZ, neighbours, plantLookup } = crossPlantContextOf(options)
  const plates: Array<CrossPlantQuad> = []
  for (let lx = minX; lx < maxX; lx += LOOP_STEP) {
    for (let lz = minZ; lz < maxZ; lz += LOOP_STEP) {
      for (let y = minY; y < maxY; y += LOOP_STEP) {
        const blockId = getBlock(chunk, lx, y, lz)
        if (isCrossPlant(plantLookup, blockId)) {
          let blockState: CrossPlantQuad['blockState']
          let textureStage: PlantTextureStage | undefined
          if (!VANILLA_BLOCK_TYPE_CACHE.has(blockId)) {
            const cached = cacheVanillaBlockType(blockId)
            if (Result.isFailure(cached)) {
              return Result.fail(cached.failure)
            }
          }
          const blockType = VANILLA_BLOCK_TYPE_CACHE.get(blockId)
          if (isPlantTextureBlockType(blockType)) {
            const index = blockIndex(lx, y, lz, chunk.height)
            const state = blockStateAt(chunk, index)
            if (Result.isFailure(state)) {
              return Result.fail(modelPropertyFailureOf(state.failure, blockType))
            }
            const stageValue = blockType === 'sapling' ? state.success.stage : state.success.age
            const selectedStage = plantTextureStageOf(blockId, blockType, stageValue)
            if (Result.isFailure(selectedStage)) {
              return Result.fail(modelPropertyFailureOf(selectedStage.failure, blockType))
            }
            textureStage = selectedStage.success
          }
          if (Option.isSome(TALL_GRASS_BLOCK_ID) && blockId === TALL_GRASS_BLOCK_ID.value) {
            const state = blockStateAt(chunk, blockIndex(lx, y, lz, chunk.height))
            if (Result.isFailure(state)) {
              return Result.fail(state.failure)
            }
            blockState = state.success
          }
          const input = {
            blockId,
            blockState,
            light: quadLightAt(chunk, neighbours, 'yPos', lx, y, lz),
            lx,
            lz,
            ...(typeof textureStage === 'undefined' ? {} : { textureStage }),
            y,
          }
          if (isCropTextureBlockType(blockType)) {
            plates.push(...cropPlatesFor(input))
          } else if (blockType === 'seagrass') {
            plates.push(...seagrassPlatesFor(input))
          } else {
            plates.push(
              ...platesFor(input),
            )
          }
        }
      }
    }
  }
  return Result.succeed(plates)
}
