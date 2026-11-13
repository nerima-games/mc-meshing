import { Option, Result } from 'effect'
import type { BlockType, CollisionShape, EffectiveBlockStateValues, RenderKind } from '@nerima-games/mc-kernel'
import type { BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel/domain/block-registry'
import { AIR, type BlockId, MAX_BLOCK_ID, blockIdAt } from './block-data.js'
import {
  BLOCK_IDS,
  blockTypeOfId,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkViewFailure,
  type ChunkView,
  blockIndex,
  blockStateAt,
  getBlock,
} from './chunk-view.js'
import { FACES, type Face, type FaceDirection, type FaceFor, faceOf } from './faces.js'
import { type RailFaceDirection, railVerticesOf } from './rail-geometry.js'
import {
  type RailRenderKind,
  type RailRenderKindFailure,
  type RailSpecialBlockQuad,
  type InvalidBlockStateModelProperty,
  type InvalidBlockStateModelPropertyFailure,
  type SpecialBlockQuad,
  type SpecialMeshRegion,
  type SpecialRenderKind,
  type SpecialVertex,
  railRenderKindOf,
} from './special-types.js'
import { type RailShape, type RailShapeFailure, railShapeAt } from './rail-types.js'
import { EMPTY_MESH_CONFIG, type MeshConfig } from './opacity.js'
import type { QuadLight } from './light-types.js'
import { quadLightAt } from './light-sampling.js'

export type {
  SpecialBlockQuad,
  SpecialMeshRegion,
  RailRenderKind,
  RailSpecialBlockQuad,
  SpecialRenderKind,
  SpecialVertex,
} from './special-types.js'

const SPECIAL_KIND_NONE = 0
const CACTUS_KIND_CODE = 1
const LILY_PAD_KIND_CODE = 2
const RAIL_KIND_CODE = 3
const SLAB_KIND_CODE = 4
const PRESSURE_PLATE_KIND_CODE = 5
const DOOR_KIND_CODE = 6
const STAIRS_KIND_CODE = 7
const REDSTONE_WIRE_KIND_CODE = 8
const REPEATER_KIND_CODE = 9
const LADDER_KIND_CODE = 10
const LEVER_KIND_CODE = 11
const STONE_BUTTON_KIND_CODE = 12
const SNOW_LAYER_KIND_CODE = 13
const BLOCK_MODEL_KIND_CODE = 14

const SPECIAL_KIND_CODE = {
  cactus: CACTUS_KIND_CODE,
  lilyPad: LILY_PAD_KIND_CODE,
  pressurePlate: PRESSURE_PLATE_KIND_CODE,
  rail: RAIL_KIND_CODE,
  redstoneWire: REDSTONE_WIRE_KIND_CODE,
  repeater: REPEATER_KIND_CODE,
  slab: SLAB_KIND_CODE,
  door: DOOR_KIND_CODE,
  stairs: STAIRS_KIND_CODE,
  ladder: LADDER_KIND_CODE,
  lever: LEVER_KIND_CODE,
  stoneButton: STONE_BUTTON_KIND_CODE,
  snowLayer: SNOW_LAYER_KIND_CODE,
  blockModel: BLOCK_MODEL_KIND_CODE,
} as const satisfies Record<SpecialRenderKind, number>

const UNIT_ORIGIN = 0
const UNIT_SIZE = 1
const BLOCK_MODEL_SUBDIVISIONS = 16
const THIN_BLOCK_INSET = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const LILY_PAD_HEIGHT_DIVISOR = 64
const LILY_PAD_HEIGHT = UNIT_SIZE / LILY_PAD_HEIGHT_DIVISOR
const SLAB_HEIGHT_DIVISOR = 2
const SLAB_HEIGHT = UNIT_SIZE / SLAB_HEIGHT_DIVISOR
const PRESSURE_PLATE_HEIGHT = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const DOOR_THICKNESS = 3 * UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const REPEATER_BASE_HEIGHT = UNIT_SIZE / 8
const REPEATER_TORCH_SIZE = UNIT_SIZE / 8
const REPEATER_TORCH_HEIGHT = UNIT_SIZE / 4
const REPEATER_TORCH_BASE = REPEATER_BASE_HEIGHT
const SNOW_LAYER_DIVISOR = 8
const BUTTON_DEPTH = 2 * UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const PRESSED_BUTTON_DEPTH = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const BUTTON_HEIGHT = UNIT_SIZE / 4
const LEVER_HANDLE_WIDTH = UNIT_SIZE / 8
const LEVER_HANDLE_HEIGHT = UNIT_SIZE / 3
const LEVER_HANDLE_LENGTH = UNIT_SIZE / 4
const LADDER_THICKNESS = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const WIRE_WIDTH = UNIT_SIZE / 4
const WIRE_EDGE_INSET = WIRE_WIDTH / 2
const WIRE_HEIGHT = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const TORCH_BASE_INSET = UNIT_SIZE / 4
const TORCH_DELAY_STEP = UNIT_SIZE / 8
const WALL_BUTTON_CENTER = UNIT_SIZE / 2
const WALL_BUTTON_MIN_Y = WALL_BUTTON_CENTER - BUTTON_HEIGHT / 2
const WALL_BUTTON_MAX_Y = WALL_BUTTON_CENTER + BUTTON_HEIGHT / 2
const GRID_SIZE = 2
const GRID_CELL_SIZE = UNIT_SIZE / GRID_SIZE
const GRID_COORD_MIN = 0
const GRID_COORD_MAX = GRID_SIZE - 1
const GRID_LAYER_MIN = 0
const GRID_LAYER_MAX = GRID_SIZE - 1

const STATEFUL_SPECIAL_KIND_BY_BLOCK_TYPE: Partial<Record<BlockType, SpecialRenderKind>> = {
  door: 'door',
  door_open: 'door',
  ladder: 'ladder',
  lever: 'lever',
  oak_stairs: 'stairs',
  purpur_stairs: 'stairs',
  redstone_wire: 'redstoneWire',
  repeater: 'repeater',
  snow: 'snowLayer',
  stone_button: 'stoneButton',
  torch: 'blockModel',
  redstone_torch: 'blockModel',
  redstone_wall_torch: 'blockModel',
  piston: 'blockModel',
  sticky_piston: 'blockModel',
  farmland: 'blockModel',
  chest: 'blockModel',
  ender_chest: 'blockModel',
  bed: 'blockModel',
  anvil: 'blockModel',
  cauldron: 'blockModel',
  water_cauldron: 'blockModel',
  hopper: 'blockModel',
  comparator: 'blockModel',
  enchanting_table: 'blockModel',
  brewing_stand: 'blockModel',
  end_portal_frame: 'blockModel',
  end_portal_frame_filled: 'blockModel',
  end_rod: 'blockModel',
  piston_head: 'blockModel',
  dragon_egg: 'blockModel',
  end_portal: 'blockModel',
  nether_portal: 'blockModel',
  fire: 'blockModel',
  wither_skeleton_skull: 'blockModel',
  chorus_flower: 'blockModel',
  chorus_plant: 'blockModel',
  end_crystal: 'blockModel',
  end_gateway: 'blockModel',
}

const UNKNOWN_OPACITY_CODE = 0
const OPAQUE_OPACITY_CODE = 1
const NON_OPAQUE_CODE = 2

export type SpecialBlockLookup = {
  readonly kindCodes: Readonly<Uint8Array>
  readonly opacityCodes: Readonly<Uint8Array>
  readonly railKinds: readonly (RailRenderKind | undefined)[]
}

export type SpecialBlockLookupFailure =
  | BlockRegistryResolutionFailure
  | RailRenderKindFailure
  | { readonly _tag: 'MissingSpecialBlockType'; readonly blockId: BlockId }

export type SpecialMeshFailure =
  | SpecialBlockLookupFailure
  | ChunkViewFailure
  | RailShapeFailure
  | InvalidBlockStateModelPropertyFailure
  | { readonly _tag: 'MissingSpecialBlockLookupEntry'; readonly blockId: BlockId }
  | { readonly _tag: 'MissingSpecialBlockNeighbourView'; readonly blockId: BlockId; readonly direction: FaceDirection }
  | { readonly _tag: 'UnsupportedSpecialBlockModel'; readonly blockId: BlockId; readonly blockType: BlockType }

const lightPropertiesOf = (light?: QuadLight): { light?: QuadLight } => {
  if (light) {
    return { light }
  }
  return {}
}

const specialKindCodeOf = (
  renderKind: RenderKind,
  collisionShape: CollisionShape,
  blockType: BlockType,
): number => {
  const statefulKind = STATEFUL_SPECIAL_KIND_BY_BLOCK_TYPE[blockType]
  if (typeof statefulKind !== 'undefined') {
    return SPECIAL_KIND_CODE[statefulKind]
  }
  switch (renderKind) {
    case 'cactus':
      return CACTUS_KIND_CODE
    case 'lilyPad':
      return LILY_PAD_KIND_CODE
    case 'rail':
      return RAIL_KIND_CODE
    default:
      switch (collisionShape) {
        case 'pressurePlate':
          return PRESSURE_PLATE_KIND_CODE
        case 'slab':
          return SLAB_KIND_CODE
        default:
          return SPECIAL_KIND_NONE
      }
  }
}

const buildSpecialBlockLookup = (): Result.Result<SpecialBlockLookup, SpecialBlockLookupFailure> => {
  const kindCodes = new Uint8Array(MAX_BLOCK_ID + UNIT_SIZE)
  const opacityCodes = new Uint8Array(MAX_BLOCK_ID + UNIT_SIZE)
  const railKinds: Array<RailRenderKind | undefined> = []
  for (const blockId of BLOCK_IDS) {
    const renderKind = propertyOfBlockId(blockId, 'renderKind')
    if (Result.isFailure(renderKind)) {
      return Result.fail(renderKind.failure)
    }
    const collisionShape = propertyOfBlockId(blockId, 'collisionShape')
    if (Result.isFailure(collisionShape)) {
      return Result.fail(collisionShape.failure)
    }
    const opacity = propertyOfBlockId(blockId, 'opacity')
    if (Result.isFailure(opacity)) {
      return Result.fail(opacity.failure)
    }
    const blockType = blockTypeOfId(blockId)
    if (Result.isFailure(blockType)) {
      return Result.fail(blockType.failure)
    }
    if (typeof blockType.success === 'undefined') {
      return Result.fail({ _tag: 'MissingSpecialBlockType', blockId })
    }
    kindCodes[blockId] = specialKindCodeOf(renderKind.success, collisionShape.success, blockType.success)
    opacityCodes[blockId] = opacity.success === 'opaque' ? OPAQUE_OPACITY_CODE : NON_OPAQUE_CODE
    if (renderKind.success === 'rail') {
      const railKind = propertyOfBlockId(blockId, 'railKind')
      if (Result.isFailure(railKind)) {
        return Result.fail(railKind.failure)
      }
      const railRenderKind = railRenderKindOf(railKind.success)
      if (Result.isFailure(railRenderKind)) {
        return Result.fail(railRenderKind.failure)
      }
      railKinds[blockId] = railRenderKind.success
    }
  }
  return Result.succeed({ kindCodes, opacityCodes, railKinds })
}

export const SPECIAL_BLOCK_LOOKUP: Result.Result<SpecialBlockLookup, SpecialBlockLookupFailure> = buildSpecialBlockLookup()

type BoxRenderKind = Exclude<SpecialRenderKind, 'blockModel' | 'lilyPad' | 'rail' | 'redstoneWire'>
type FixedBoxRenderKind = Extract<SpecialRenderKind, 'cactus' | 'pressurePlate'>

const specialKindOf = (lookup: SpecialBlockLookup, blockId: BlockId): SpecialRenderKind | null => {
  switch (lookup.kindCodes[blockId]) {
    case SPECIAL_KIND_CODE.cactus:
      return 'cactus'
    case SPECIAL_KIND_CODE.lilyPad:
      return 'lilyPad'
    case SPECIAL_KIND_CODE.pressurePlate:
      return 'pressurePlate'
    case SPECIAL_KIND_CODE.rail:
      return 'rail'
    case SPECIAL_KIND_CODE.slab:
      return 'slab'
    case SPECIAL_KIND_CODE.door:
      return 'door'
    case SPECIAL_KIND_CODE.stairs:
      return 'stairs'
    case SPECIAL_KIND_CODE.redstoneWire:
      return 'redstoneWire'
    case SPECIAL_KIND_CODE.repeater:
      return 'repeater'
    case SPECIAL_KIND_CODE.ladder:
      return 'ladder'
    case SPECIAL_KIND_CODE.lever:
      return 'lever'
    case SPECIAL_KIND_CODE.stoneButton:
      return 'stoneButton'
    case SPECIAL_KIND_CODE.snowLayer:
      return 'snowLayer'
    case SPECIAL_KIND_CODE.blockModel:
      return 'blockModel'
    default:
      return null
  }
}

export const isSpecialBlock = (lookup: SpecialBlockLookup, blockId: BlockId): boolean => {
  const kindCode = lookup.kindCodes[blockId]
  return typeof kindCode !== 'undefined' && kindCode !== SPECIAL_KIND_NONE
}

const missingSpecialBlockLookupEntry = (blockId: BlockId): SpecialMeshFailure => {
  const renderKind = propertyOfBlockId(blockId, 'renderKind')
  if (Result.isFailure(renderKind)) {
    return renderKind.failure
  }
  return { _tag: 'MissingSpecialBlockLookupEntry', blockId }
}

const isConfiguredBlock = (config: MeshConfig, blockId: BlockId): boolean =>
  config.crossPlantBlockIds.has(blockId) ||
  config.transparentSolidBlockIds.has(blockId) ||
  config.waterBlockIds.has(blockId) ||
  config.fluidMaxLevels.has(blockId)

const isConfiguredNonOpaqueBlock = (config: MeshConfig, blockId: BlockId): boolean =>
  config.crossPlantBlockIds.has(blockId) ||
  config.transparentSolidBlockIds.has(blockId) ||
  config.waterBlockIds.has(blockId)

const ensureRegisteredBlock = (
  lookup: SpecialBlockLookup,
  blockId: BlockId,
  config: MeshConfig,
): Option.Option<SpecialMeshFailure> => {
  const opacityCode = lookup.opacityCodes[blockId]
  if (typeof opacityCode === 'undefined' || opacityCode === UNKNOWN_OPACITY_CODE) {
    if (isConfiguredBlock(config, blockId)) {
      return Option.none()
    }
    return Option.some(missingSpecialBlockLookupEntry(blockId))
  }
  return Option.none()
}

type BoxBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}

type BlockPosition = readonly [lx: number, y: number, lz: number]

type SpecialGeometryBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
) => Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure>

type SpecialGeometryBoundsResolver = Readonly<Record<BoxRenderKind, SpecialGeometryBoundsOf>>

type SpecialShapeGeometry = {
  readonly config: MeshConfig
  readonly boundsOf: SpecialGeometryBoundsResolver
}

type SpecialShapeContext = {
  readonly result: Array<SpecialBlockQuad>
  readonly lookup: SpecialBlockLookup
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly blockId: BlockId
  readonly kind: BoxRenderKind
  readonly position: BlockPosition
  readonly blockState: EffectiveBlockStateValues | null
  readonly config: MeshConfig
  readonly geometryBoundsOf: SpecialGeometryBoundsResolver
}

type BoxVertexFactory = (
  bounds: BoxBounds,
) => readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex]

const BOX_VERTEX_FACTORIES: Readonly<Record<FaceDirection, BoxVertexFactory>> = {
  xNeg: ({ minX, minY, minZ, maxZ, maxY }) => [
    [minX, minY, minZ],
    [minX, minY, maxZ],
    [minX, maxY, maxZ],
    [minX, maxY, minZ],
  ],
  xPos: ({ maxX, minY, maxZ, minZ, maxY }) => [
    [maxX, minY, maxZ],
    [maxX, minY, minZ],
    [maxX, maxY, minZ],
    [maxX, maxY, maxZ],
  ],
  yNeg: ({ minX, minY, minZ, maxX, maxZ }) => [
    [minX, minY, minZ],
    [maxX, minY, minZ],
    [maxX, minY, maxZ],
    [minX, minY, maxZ],
  ],
  yPos: ({ minX, maxY, maxZ, maxX, minZ }) => [
    [minX, maxY, maxZ],
    [maxX, maxY, maxZ],
    [maxX, maxY, minZ],
    [minX, maxY, minZ],
  ],
  zNeg: ({ maxX, minY, minZ, minX, maxY }) => [
    [maxX, minY, minZ],
    [minX, minY, minZ],
    [minX, maxY, minZ],
    [maxX, maxY, minZ],
  ],
  zPos: ({ minX, minY, maxZ, maxX, maxY }) => [
    [minX, minY, maxZ],
    [maxX, minY, maxZ],
    [maxX, maxY, maxZ],
    [minX, maxY, maxZ],
  ],
}

const boxVertices = (
  face: Face,
  bounds: BoxBounds,
): readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex] =>
  BOX_VERTEX_FACTORIES[face.direction](bounds)

const TOP_FACE = faceOf('yPos')

type BoxBoundsFactory = (lx: number, y: number, lz: number) => BoxBounds

const BOX_BOUNDS_FACTORIES: Readonly<Record<FixedBoxRenderKind, BoxBoundsFactory>> = {
  cactus: (lx, y, lz) => ({
    maxX: lx + UNIT_SIZE - THIN_BLOCK_INSET,
    maxY: y + UNIT_SIZE,
    maxZ: lz + UNIT_SIZE - THIN_BLOCK_INSET,
    minX: lx + THIN_BLOCK_INSET,
    minY: y,
    minZ: lz + THIN_BLOCK_INSET,
  }),
  pressurePlate: (lx, y, lz) => ({
    maxX: lx + UNIT_SIZE - THIN_BLOCK_INSET,
    maxY: y + PRESSURE_PLATE_HEIGHT,
    maxZ: lz + UNIT_SIZE - THIN_BLOCK_INSET,
    minX: lx + THIN_BLOCK_INSET,
    minY: y,
    minZ: lz + THIN_BLOCK_INSET,
  }),
}

const boxBoundsFor = (kind: FixedBoxRenderKind, lx: number, y: number, lz: number): BoxBounds =>
  BOX_BOUNDS_FACTORIES[kind](lx, y, lz)

const railKindOf = (
  lookup: SpecialBlockLookup,
  blockId: BlockId,
): Result.Result<RailRenderKind, RailRenderKindFailure> => {
  const railKind = lookup.railKinds[blockId]
  return typeof railKind === 'undefined'
    ? Result.fail({ _tag: 'MissingRailRenderKind', railKind: 'none' })
    : Result.succeed(railKind)
}

const makeBoxQuad = (
  blockId: BlockId,
  kind: BoxRenderKind,
  face: Face,
  bounds: BoxBounds,
  light: QuadLight | undefined,
  blockState: EffectiveBlockStateValues | null,
): SpecialBlockQuad => ({
  blockId,
  kind,
  vertices: boxVertices(face, bounds),
  ...face,
  ...lightPropertiesOf(light),
  ...(blockState ? { blockState } : {}),
})

const requiredStateProperty = <Value>(
  value: Value | undefined,
  blockId: BlockId,
  property: InvalidBlockStateModelProperty,
): Result.Result<Value, SpecialMeshFailure> =>
  typeof value === 'undefined'
    ? Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property })
    : Result.succeed(value)

const BLOCK_BOUNDARY_TESTS: Readonly<Record<FaceDirection, (bounds: BoxBounds, position: BlockPosition) => boolean>> = {
  xNeg: (bounds, [lx]) => bounds.minX === lx,
  xPos: (bounds, [lx]) => bounds.maxX === lx + UNIT_SIZE,
  yNeg: (bounds, [, y]) => bounds.minY === y,
  yPos: (bounds, [, y]) => bounds.maxY === y + UNIT_SIZE,
  zNeg: (bounds, [, , lz]) => bounds.minZ === lz,
  zPos: (bounds, [, , lz]) => bounds.maxZ === lz + UNIT_SIZE,
}

const boxFaceTouchesBlockBoundary = (bounds: BoxBounds, position: BlockPosition, direction: FaceDirection): boolean =>
  BLOCK_BOUNDARY_TESTS[direction](bounds, position)

type CoordinateAxis = 'x' | 'y' | 'z'
type FaceRectangleAxes = readonly [CoordinateAxis, CoordinateAxis]
type AxisBoundsUpdater = (bounds: BoxBounds, min: number, max: number) => BoxBounds

const AXIS_BOUNDS_UPDATERS: Readonly<Record<CoordinateAxis, AxisBoundsUpdater>> = {
  x: (bounds, minX, maxX) => ({ ...bounds, minX, maxX }),
  y: (bounds, minY, maxY) => ({ ...bounds, minY, maxY }),
  z: (bounds, minZ, maxZ) => ({ ...bounds, minZ, maxZ }),
}

const FACE_RECTANGLE_AXES: Readonly<Record<FaceDirection, FaceRectangleAxes>> = {
  xNeg: ['y', 'z'],
  xPos: ['y', 'z'],
  yNeg: ['x', 'z'],
  yPos: ['x', 'z'],
  zNeg: ['x', 'y'],
  zPos: ['x', 'y'],
}

const OPPOSITE_FACE: Readonly<Record<FaceDirection, FaceDirection>> = {
  xNeg: 'xPos',
  xPos: 'xNeg',
  yNeg: 'yPos',
  yPos: 'yNeg',
  zNeg: 'zPos',
  zPos: 'zNeg',
}

const boundsOnAxis = (bounds: BoxBounds, axis: CoordinateAxis): readonly [number, number] => {
  if (axis === 'x') return [bounds.minX, bounds.maxX]
  if (axis === 'y') return [bounds.minY, bounds.maxY]
  return [bounds.minZ, bounds.maxZ]
}

type FaceCoverage = {
  readonly minU: number
  readonly maxU: number
  readonly minV: number
  readonly maxV: number
}

const boundsWithFaceCoverage = (
  bounds: BoxBounds,
  axes: FaceRectangleAxes,
  { minU, maxU, minV, maxV }: FaceCoverage,
): BoxBounds => {
  const afterU = AXIS_BOUNDS_UPDATERS[axes[0]](bounds, minU, maxU)
  return AXIS_BOUNDS_UPDATERS[axes[1]](afterU, minV, maxV)
}

const adjacentIntervals = (values: ReadonlyArray<number>): ReadonlyArray<readonly [number, number]> =>
  values.flatMap((min, index) => {
    const max = values[index + 1]
    return typeof max === 'undefined' ? [] : [[min, max] as const]
  })

const subtractCoveredFace = (
  bounds: BoxBounds,
  direction: FaceDirection,
  neighbourPosition: BlockPosition,
  neighbourBounds: ReadonlyArray<BoxBounds>,
): ReadonlyArray<BoxBounds> => {
  const opposite = OPPOSITE_FACE[direction]
  const axes = FACE_RECTANGLE_AXES[direction]
  const [minU, maxU] = boundsOnAxis(bounds, axes[0])
  const [minV, maxV] = boundsOnAxis(bounds, axes[1])
  const coverages: Array<FaceCoverage> = []
  for (const candidate of neighbourBounds) {
    if (!boxFaceTouchesBlockBoundary(candidate, neighbourPosition, opposite)) {
      continue
    }
    const [candidateMinU, candidateMaxU] = boundsOnAxis(candidate, axes[0])
    const [candidateMinV, candidateMaxV] = boundsOnAxis(candidate, axes[1])
    const coverMinU = Math.max(minU, candidateMinU)
    const coverMaxU = Math.min(maxU, candidateMaxU)
    const coverMinV = Math.max(minV, candidateMinV)
    const coverMaxV = Math.min(maxV, candidateMaxV)
    if (coverMinU < coverMaxU && coverMinV < coverMaxV) {
      coverages.push({ minU: coverMinU, maxU: coverMaxU, minV: coverMinV, maxV: coverMaxV })
    }
  }
  if (coverages.length === 0) {
    return [bounds]
  }

  const uCoordinates = [...new Set([minU, maxU, ...coverages.flatMap(({ minU: low, maxU: high }) => [low, high])])]
    .sort((left, right) => left - right)
  const vCoordinates = [...new Set([minV, maxV, ...coverages.flatMap(({ minV: low, maxV: high }) => [low, high])])]
    .sort((left, right) => left - right)
  const visible: Array<BoxBounds> = []
  for (const [tileMinU, tileMaxU] of adjacentIntervals(uCoordinates)) {
    for (const [tileMinV, tileMaxV] of adjacentIntervals(vCoordinates)) {
      const centerU = (tileMinU + tileMaxU) / 2
      const centerV = (tileMinV + tileMaxV) / 2
      const covered = coverages.some((coverage) =>
        centerU > coverage.minU && centerU < coverage.maxU &&
        centerV > coverage.minV && centerV < coverage.maxV,
      )
      if (!covered) {
        visible.push(boundsWithFaceCoverage(bounds, axes, {
          minU: tileMinU,
          maxU: tileMaxU,
          minV: tileMinV,
          maxV: tileMaxV,
        }))
      }
    }
  }
  return visible
}

type SpecialNeighbourLocation = {
  readonly chunk: ChunkView
  readonly position: BlockPosition
  readonly geometryPosition: BlockPosition
}

const specialNeighbourAtFace = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  position: BlockPosition,
  face: Face,
): Option.Option<SpecialNeighbourLocation> => {
  const [lx, y, lz] = position
  let neighbourChunk: ChunkView | undefined = chunk
  let neighbourX = lx + face.nx
  const neighbourY = y + face.ny
  let neighbourZ = lz + face.nz
  let geometryOffsetX = 0
  let geometryOffsetZ = 0
  if (neighbourX < 0) {
    neighbourChunk = neighbours.xNeg
    neighbourX = CHUNK_SIZE - 1
    geometryOffsetX = -CHUNK_SIZE
  } else if (neighbourX >= CHUNK_SIZE) {
    neighbourChunk = neighbours.xPos
    neighbourX = 0
    geometryOffsetX = CHUNK_SIZE
  } else if (neighbourZ < 0) {
    neighbourChunk = neighbours.zNeg
    neighbourZ = CHUNK_SIZE - 1
    geometryOffsetZ = -CHUNK_SIZE
  } else if (neighbourZ >= CHUNK_SIZE) {
    neighbourChunk = neighbours.zPos
    neighbourZ = 0
    geometryOffsetZ = CHUNK_SIZE
  }
  if (typeof neighbourChunk === 'undefined' || neighbourY < 0 || neighbourY >= chunk.height) {
    return Option.none()
  }
  return Option.some({
    chunk: neighbourChunk,
    position: [neighbourX, neighbourY, neighbourZ],
    geometryPosition: [neighbourX + geometryOffsetX, neighbourY, neighbourZ + geometryOffsetZ],
  })
}

function isOpenToSpecial(
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  kind: BoxRenderKind,
  position: BlockPosition,
  face: Face,
  bounds: BoxBounds,
  geometry: SpecialShapeGeometry,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> {
  if (!boxFaceTouchesBlockBoundary(bounds, position, face.direction)) {
    return Result.succeed([bounds])
  }
  const neighbour = specialNeighbourAtFace(chunk, neighbours, position, face)
  if (Option.isNone(neighbour)) {
    return Result.succeed([bounds])
  }
  const neighbourId = getBlock(neighbour.value.chunk, ...neighbour.value.position)
  if (neighbourId === AIR) {
    return Result.succeed([bounds])
  }
  const opacityCode = lookup.opacityCodes[neighbourId]
  if (typeof opacityCode === 'undefined' || opacityCode === UNKNOWN_OPACITY_CODE) {
    if (isConfiguredBlock(geometry.config, neighbourId)) {
      return isConfiguredNonOpaqueBlock(geometry.config, neighbourId)
        ? Result.succeed([bounds])
        : Result.succeed([])
    }
    return Result.fail(missingSpecialBlockLookupEntry(neighbourId))
  }
  if (specialKindOf(lookup, neighbourId) !== kind) {
    return opacityCode === OPAQUE_OPACITY_CODE
      ? Result.succeed([])
      : Result.succeed([bounds])
  }
  const neighbourState = blockStateAt(
    neighbour.value.chunk,
    blockIndex(...neighbour.value.position, neighbour.value.chunk.height),
  )
  if (Result.isFailure(neighbourState)) {
    return Result.fail(neighbourState.failure)
  }
  return Result.map(
    geometry.boundsOf[kind](neighbourId, neighbour.value.geometryPosition, neighbourState.success),
    (neighbourBounds) => {
      const visibleBounds = subtractCoveredFace(bounds, face.direction, neighbour.value.geometryPosition, neighbourBounds)
      return kind === 'snowLayer' && visibleBounds.length > 0 ? [bounds] : visibleBounds
    },
  )
}

const lilyPadQuad = (
  blockId: BlockId,
  lx: number,
  y: number,
  lz: number,
  light: QuadLight | undefined,
): SpecialBlockQuad => {
  const minX = lx + THIN_BLOCK_INSET
  const maxX = lx + UNIT_SIZE - THIN_BLOCK_INSET
  const minZ = lz + THIN_BLOCK_INSET
  const maxZ = lz + UNIT_SIZE - THIN_BLOCK_INSET
  const top = y + LILY_PAD_HEIGHT
  return {
    blockId,
    kind: 'lilyPad',
    vertices: [
      [minX, top, maxZ],
      [maxX, top, maxZ],
      [maxX, top, minZ],
      [minX, top, minZ],
    ],
    ...TOP_FACE,
    ...lightPropertiesOf(light),
  }
}

const railQuad = (
  railKind: RailRenderKind,
  blockId: BlockId,
  geometryShape: RailShape,
  blockState: EffectiveBlockStateValues,
  legacyShape: RailShape | undefined,
  position: BlockPosition,
  face: FaceFor<RailFaceDirection>,
  light: QuadLight | undefined,
): RailSpecialBlockQuad => {
  const [lx, y, lz] = position
  return {
    blockId,
    kind: 'rail',
    railKind,
    vertices: railVerticesOf(geometryShape, lx, y, lz, face.direction),
    ...face,
    ...lightPropertiesOf(light),
    ...(typeof legacyShape === 'undefined' ? {} : { railShape: legacyShape }),
    blockState,
  }
}

const railQuads = (
  lookup: SpecialBlockLookup,
  blockId: BlockId,
  position: BlockPosition,
  geometryShape: RailShape,
  blockState: EffectiveBlockStateValues,
  legacyShape: RailShape | undefined,
  topLight: QuadLight | undefined,
  bottomLight: QuadLight | undefined,
): Result.Result<readonly [RailSpecialBlockQuad, RailSpecialBlockQuad], SpecialMeshFailure> => {
  const railKind = railKindOf(lookup, blockId)
  if (Result.isFailure(railKind)) {
    return Result.fail(railKind.failure)
  }
  const top = railQuad(railKind.success, blockId, geometryShape, blockState, legacyShape, position, TOP_FACE, topLight)
  const bottom = railQuad(railKind.success, blockId, geometryShape, blockState, legacyShape, position, faceOf('yNeg'), bottomLight)
  return Result.succeed([top, bottom])
}

const railShapeFromState = (
  shape: EffectiveBlockStateValues['shape'],
  blockId: BlockId,
): Result.Result<RailShape, SpecialMeshFailure> => {
  if (
    shape === 'north_south' || shape === 'east_west' ||
    shape === 'ascending_east' || shape === 'ascending_west' ||
    shape === 'ascending_north' || shape === 'ascending_south' ||
    shape === 'south_east' || shape === 'south_west' ||
    shape === 'north_west' || shape === 'north_east'
  ) {
    return Result.succeed(shape)
  }
  return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'shape' })
}

const boxFaceVisible = (
  context: SpecialShapeContext,
  bounds: BoxBounds,
  face: Face,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> =>
  isOpenToSpecial(
    context.lookup,
    context.chunk,
    context.neighbours,
    context.kind,
    context.position,
    face,
    bounds,
    { config: context.config, boundsOf: context.geometryBoundsOf },
  )

const meshBoxCell = (
  context: SpecialShapeContext,
  bounds: BoxBounds,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = context.position
  for (const face of FACES) {
    const visible = boxFaceVisible(context, bounds, face)
    if (Result.isFailure(visible)) {
      return Result.fail(visible.failure)
    }
    for (const faceBounds of visible.success) {
      context.result.push(
        makeBoxQuad(
          context.blockId,
          context.kind,
          face,
          faceBounds,
          quadLightAt(context.chunk, context.neighbours, face.direction, lx, y, lz),
          context.blockState,
        ),
      )
    }
  }
  return Result.void
}

type HorizontalFacing = Exclude<NonNullable<EffectiveBlockStateValues['facing']>, 'up' | 'down'>
type StairShape = Extract<NonNullable<EffectiveBlockStateValues['shape']>, 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right'>
type StairHalf = Extract<NonNullable<EffectiveBlockStateValues['half']>, 'bottom' | 'top'>
type DoorHinge = NonNullable<EffectiveBlockStateValues['hinge']>
type HorizontalConnection = 'north' | 'east' | 'south' | 'west'

const horizontalFacingOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<HorizontalFacing, SpecialMeshFailure> => {
  const facing = state.facing
  return facing === 'north' || facing === 'east' || facing === 'south' || facing === 'west'
    ? Result.succeed(facing)
    : Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'facing' })
}

const stairShapeOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<StairShape, SpecialMeshFailure> => {
  const shape = state.shape
  return shape === 'straight' || shape === 'inner_left' || shape === 'inner_right' || shape === 'outer_left' || shape === 'outer_right'
    ? Result.succeed(shape)
    : Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'shape' })
}

type StairModelState = {
  readonly facing: HorizontalFacing
  readonly half: StairHalf
  readonly shape: StairShape
}

const stairModelStateOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<StairModelState, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const half = state.half
  if (half !== 'bottom' && half !== 'top') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'half' })
  }
  return Result.map(stairShapeOf(state, blockId), (shape) => ({ facing: facing.success, half, shape }))
}

const fullBlockBounds = (lx: number, y: number, lz: number): BoxBounds => ({
  minX: lx,
  maxX: lx + UNIT_SIZE,
  minY: y,
  maxY: y + UNIT_SIZE,
  minZ: lz,
  maxZ: lz + UNIT_SIZE,
})

const boundsAtGridCell = (
  lx: number,
  y: number,
  lz: number,
  gridX: number,
  gridY: number,
  gridZ: number,
): BoxBounds => ({
  minX: lx + gridX * GRID_CELL_SIZE,
  maxX: lx + (gridX + 1) * GRID_CELL_SIZE,
  minY: y + gridY * GRID_CELL_SIZE,
  maxY: y + (gridY + 1) * GRID_CELL_SIZE,
  minZ: lz + gridZ * GRID_CELL_SIZE,
  maxZ: lz + (gridZ + 1) * GRID_CELL_SIZE,
})

const gridCellCode = (gridX: number, gridY: number, gridZ: number): number =>
  gridY * GRID_SIZE * GRID_SIZE + gridZ * GRID_SIZE + gridX

const stairOccupiedCells = (facing: HorizontalFacing, half: StairHalf, shape: StairShape): ReadonlySet<number> => {
  const occupied = new Set<number>()
  const baseLayer = half === 'bottom' ? GRID_LAYER_MIN : GRID_LAYER_MAX
  const stepLayer = half === 'bottom' ? GRID_LAYER_MAX : GRID_LAYER_MIN
  for (let gridZ = GRID_COORD_MIN; gridZ <= GRID_COORD_MAX; gridZ += 1) {
    for (let gridX = GRID_COORD_MIN; gridX <= GRID_COORD_MAX; gridX += 1) {
      occupied.add(gridCellCode(gridX, baseLayer, gridZ))
    }
  }

  const facingCoordinate = facing === 'north' || facing === 'south'
    ? facing === 'north' ? GRID_COORD_MIN : GRID_COORD_MAX
    : facing === 'west' ? GRID_COORD_MIN : GRID_COORD_MAX
  const isDepthCoordinate = facing === 'north' || facing === 'south'
  const leftCoordinate = facing === 'north'
    ? GRID_COORD_MIN
    : facing === 'south'
      ? GRID_COORD_MAX
      : facing === 'east'
        ? GRID_COORD_MIN
        : GRID_COORD_MAX
  const stepCoordinates: ReadonlyArray<readonly [number, number]> = (() => {
    const frontRow: ReadonlyArray<readonly [number, number]> = isDepthCoordinate
      ? [
          [GRID_COORD_MIN, facingCoordinate] as const,
          [GRID_COORD_MAX, facingCoordinate] as const,
        ]
      : [
          [facingCoordinate, GRID_COORD_MIN] as const,
          [facingCoordinate, GRID_COORD_MAX] as const,
        ]
    if (shape === 'straight') {
      return frontRow
    }
    if (shape === 'outer_left' || shape === 'outer_right') {
      const rightCoordinate = GRID_SIZE - 1 - leftCoordinate
      const sideCoordinate = shape === 'outer_left' ? leftCoordinate : rightCoordinate
      const outerCell = isDepthCoordinate
        ? [sideCoordinate, facingCoordinate] as const
        : [facingCoordinate, sideCoordinate] as const
      return [outerCell]
    }
    const backCoordinate = GRID_SIZE - 1 - facingCoordinate
    const sideCoordinate = shape === 'inner_left'
      ? leftCoordinate
      : GRID_SIZE - 1 - leftCoordinate
    const innerCell = isDepthCoordinate
      ? [sideCoordinate, backCoordinate] as const
      : [backCoordinate, sideCoordinate] as const
    return [...frontRow, innerCell]
  })()

  for (const [gridX, gridZ] of stepCoordinates) {
    occupied.add(gridCellCode(gridX, stepLayer, gridZ))
  }
  return occupied
}

const GRID_NEIGHBOURS: Readonly<Record<FaceDirection, readonly [number, number, number]>> = {
  xNeg: [-1, 0, 0],
  xPos: [1, 0, 0],
  yNeg: [0, -1, 0],
  yPos: [0, 1, 0],
  zNeg: [0, 0, -1],
  zPos: [0, 0, 1],
}

type GridFaceBoundaryCheck = (gridX: number, gridY: number, gridZ: number) => boolean

const GRID_FACE_BOUNDARIES: Readonly<Record<FaceDirection, GridFaceBoundaryCheck>> = {
  xNeg: (gridX) => gridX === GRID_COORD_MIN,
  xPos: (gridX) => gridX === GRID_COORD_MAX,
  yNeg: (_gridX, gridY) => gridY === GRID_LAYER_MIN,
  yPos: (_gridX, gridY) => gridY === GRID_LAYER_MAX,
  zNeg: (_gridX, _gridY, gridZ) => gridZ === GRID_COORD_MIN,
  zPos: (_gridX, _gridY, gridZ) => gridZ === GRID_COORD_MAX,
}

const voxelFaceIsInternal = (
  occupied: ReadonlySet<number>,
  gridX: number,
  gridY: number,
  gridZ: number,
  face: Face,
): boolean => {
  const [dx, dy, dz] = GRID_NEIGHBOURS[face.direction]
  const adjacentX = gridX + dx
  const adjacentY = gridY + dy
  const adjacentZ = gridZ + dz
  return adjacentX >= GRID_COORD_MIN && adjacentX <= GRID_COORD_MAX &&
    adjacentY >= GRID_LAYER_MIN && adjacentY <= GRID_LAYER_MAX &&
    adjacentZ >= GRID_COORD_MIN && adjacentZ <= GRID_COORD_MAX &&
    occupied.has(gridCellCode(adjacentX, adjacentY, adjacentZ))
}

const voxelFaceVisible = (
  context: SpecialShapeContext,
  occupied: ReadonlySet<number>,
  gridX: number,
  gridY: number,
  gridZ: number,
  face: Face,
  bounds: BoxBounds,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> => {
  if (voxelFaceIsInternal(occupied, gridX, gridY, gridZ, face)) {
    return Result.succeed([])
  }
  if (!GRID_FACE_BOUNDARIES[face.direction](gridX, gridY, gridZ)) {
    return Result.succeed([bounds])
  }
  return isOpenToSpecial(
    context.lookup,
    context.chunk,
    context.neighbours,
    context.kind,
    context.position,
    face,
    bounds,
    { config: context.config, boundsOf: context.geometryBoundsOf },
  )
}

const meshVoxelShapeCell = (
  context: SpecialShapeContext,
  occupied: ReadonlySet<number>,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = context.position
  for (let gridY = GRID_LAYER_MIN; gridY <= GRID_LAYER_MAX; gridY += 1) {
    for (let gridZ = GRID_COORD_MIN; gridZ <= GRID_COORD_MAX; gridZ += 1) {
      for (let gridX = GRID_COORD_MIN; gridX <= GRID_COORD_MAX; gridX += 1) {
        if (!occupied.has(gridCellCode(gridX, gridY, gridZ))) {
          continue
        }
        const bounds = boundsAtGridCell(lx, y, lz, gridX, gridY, gridZ)
        for (const face of FACES) {
          const visible = voxelFaceVisible(context, occupied, gridX, gridY, gridZ, face, bounds)
          if (Result.isFailure(visible)) {
            return Result.fail(visible.failure)
          }
          for (const faceBounds of visible.success) {
            context.result.push(
              makeBoxQuad(
                context.blockId,
                context.kind,
                face,
                faceBounds,
                quadLightAt(context.chunk, context.neighbours, face.direction, lx, y, lz),
                context.blockState,
              ),
            )
          }
        }
      }
    }
  }
  return Result.void
}

const meshStairsCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(stairModelStateOf(blockState, blockId), ({ facing, half, shape }) =>
    meshVoxelShapeCell(
      { result, lookup, chunk, neighbours, blockId, kind: 'stairs', position, blockState, config, geometryBoundsOf },
      stairOccupiedCells(facing, half, shape),
    ),
  )
}

const doorHingeDirection = (facing: HorizontalFacing, hinge: DoorHinge): HorizontalFacing => {
  if (facing === 'north') {
    return hinge === 'left' ? 'west' : 'east'
  }
  if (facing === 'east') {
    return hinge === 'left' ? 'north' : 'south'
  }
  if (facing === 'south') {
    return hinge === 'left' ? 'east' : 'west'
  }
  return hinge === 'left' ? 'south' : 'north'
}

const CLOSED_DOOR_PANEL_SIDE: Readonly<Record<HorizontalFacing, HorizontalFacing>> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

const doorClosedPanelSide = (facing: HorizontalFacing): HorizontalFacing => CLOSED_DOOR_PANEL_SIDE[facing]

type DoorModelState = {
  readonly normal: HorizontalFacing
}

const doorModelStateOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<DoorModelState, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const hinge = requiredStateProperty(state.hinge, blockId, 'hinge')
  if (Result.isFailure(hinge)) return Result.fail(hinge.failure)
  if (hinge.success !== 'left' && hinge.success !== 'right') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'hinge' })
  }
  const half = state.half
  if (half !== 'lower' && half !== 'upper') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'half' })
  }
  const open = requiredStateProperty(state.open, blockId, 'open')
  if (Result.isFailure(open)) return Result.fail(open.failure)
  if (typeof open.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'open' })
  }
  return Result.succeed({
    normal: open.success
      ? doorHingeDirection(facing.success, hinge.success)
      : doorClosedPanelSide(facing.success),
  })
}

const doorBoundsOf = (
  position: BlockPosition,
  normal: HorizontalFacing,
): BoxBounds => {
  const [lx, y, lz] = position
  if (normal === 'west') {
    return { minX: lx, maxX: lx + DOOR_THICKNESS, minY: y, maxY: y + UNIT_SIZE, minZ: lz, maxZ: lz + UNIT_SIZE }
  }
  if (normal === 'east') {
    return { minX: lx + UNIT_SIZE - DOOR_THICKNESS, maxX: lx + UNIT_SIZE, minY: y, maxY: y + UNIT_SIZE, minZ: lz, maxZ: lz + UNIT_SIZE }
  }
  if (normal === 'north') {
    return { minX: lx, maxX: lx + UNIT_SIZE, minY: y, maxY: y + UNIT_SIZE, minZ: lz, maxZ: lz + DOOR_THICKNESS }
  }
  return { minX: lx, maxX: lx + UNIT_SIZE, minY: y, maxY: y + UNIT_SIZE, minZ: lz + UNIT_SIZE - DOOR_THICKNESS, maxZ: lz + UNIT_SIZE }
}

const meshDoorCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(doorModelStateOf(blockState, blockId), ({ normal }) =>
    meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind: 'door', position, blockState, config, geometryBoundsOf },
      doorBoundsOf(position, normal),
    ),
  )
}

type SlabType = 'bottom' | 'top' | 'double'

const slabTypeOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<SlabType, SpecialMeshFailure> => {
  const slabType = requiredStateProperty(state.type, blockId, 'type')
  if (Result.isFailure(slabType)) return Result.fail(slabType.failure)
  if (slabType.success === 'bottom' || slabType.success === 'top' || slabType.success === 'double') {
    return Result.succeed(slabType.success)
  }
  return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'type' })
}

const slabBoundsOf = (position: BlockPosition, slabType: SlabType): BoxBounds => {
  const [lx, y, lz] = position
  if (slabType === 'bottom') {
    return { ...fullBlockBounds(lx, y, lz), maxY: y + SLAB_HEIGHT }
  }
  if (slabType === 'top') {
    return { ...fullBlockBounds(lx, y, lz), minY: y + SLAB_HEIGHT }
  }
  return fullBlockBounds(lx, y, lz)
}

const pressurePlatePoweredOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<boolean, SpecialMeshFailure> => {
  const powered = requiredStateProperty(state.powered, blockId, 'powered')
  if (Result.isFailure(powered)) return Result.fail(powered.failure)
  return typeof powered.success === 'boolean'
    ? Result.succeed(powered.success)
    : Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'powered' })
}

const pressurePlateBoundsOf = (position: BlockPosition, powered: boolean): BoxBounds => {
  const [lx, y, lz] = position
  const bounds = boxBoundsFor('pressurePlate', lx, y, lz)
  return powered ? { ...bounds, maxY: y + PRESSURE_PLATE_HEIGHT / 2 } : bounds
}

const meshSlabCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(slabTypeOf(blockState, blockId), (slabType) =>
    meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind: 'slab', position, blockState, config, geometryBoundsOf },
      slabBoundsOf(position, slabType),
    ),
  )
}

const meshPressurePlateCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(pressurePlatePoweredOf(blockState, blockId), (powered) =>
    meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind: 'pressurePlate', position, blockState, config, geometryBoundsOf },
      pressurePlateBoundsOf(position, powered),
    ),
  )
}

const snowLayerBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<BoxBounds, SpecialMeshFailure> => {
  const layers = requiredStateProperty(state.layers, blockId, 'layers')
  if (Result.isFailure(layers)) {
    return Result.fail(layers.failure)
  }
  if (layers.success < 1 || layers.success > SNOW_LAYER_DIVISOR) {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'layers' })
  }
  const [lx, y, lz] = position
  return Result.succeed({ ...fullBlockBounds(lx, y, lz), maxY: y + layers.success / SNOW_LAYER_DIVISOR })
}

const meshSnowLayerCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(snowLayerBoundsOf(blockId, position, blockState), (bounds) =>
    meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind: 'snowLayer', position, blockState, config, geometryBoundsOf },
      bounds,
    ),
  )
}

const directionalThinBounds = (
  position: BlockPosition,
  facing: HorizontalFacing,
  thickness: number,
): BoxBounds => {
  const [lx, y, lz] = position
  if (facing === 'west') {
    return { minX: lx, maxX: lx + thickness, minY: y, maxY: y + UNIT_SIZE, minZ: lz, maxZ: lz + UNIT_SIZE }
  }
  if (facing === 'east') {
    return { minX: lx + UNIT_SIZE - thickness, maxX: lx + UNIT_SIZE, minY: y, maxY: y + UNIT_SIZE, minZ: lz, maxZ: lz + UNIT_SIZE }
  }
  if (facing === 'north') {
    return { minX: lx, maxX: lx + UNIT_SIZE, minY: y, maxY: y + UNIT_SIZE, minZ: lz, maxZ: lz + thickness }
  }
  return { minX: lx, maxX: lx + UNIT_SIZE, minY: y, maxY: y + UNIT_SIZE, minZ: lz + UNIT_SIZE - thickness, maxZ: lz + UNIT_SIZE }
}

const meshLadderCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  return meshBoxCell(
    { result, lookup, chunk, neighbours, blockId, kind: 'ladder', position, blockState, config, geometryBoundsOf },
    directionalThinBounds(position, facing.success, LADDER_THICKNESS),
  )
}

type AttachedModelState = {
  readonly facing: HorizontalFacing
  readonly face: 'floor' | 'wall' | 'ceiling'
  readonly powered: boolean
}

const attachedGeometryStateOf = (
  blockId: BlockId,
  state: EffectiveBlockStateValues,
): Result.Result<AttachedModelState, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const face = requiredStateProperty(state.face, blockId, 'face')
  if (Result.isFailure(face)) return Result.fail(face.failure)
  if (face.success !== 'floor' && face.success !== 'wall' && face.success !== 'ceiling') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'face' })
  }
  const powered = requiredStateProperty(state.powered, blockId, 'powered')
  if (Result.isFailure(powered)) return Result.fail(powered.failure)
  if (typeof powered.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'powered' })
  }
  return Result.succeed({ facing: facing.success, face: face.success, powered: powered.success })
}

const poweredDepthOf = (powered: boolean): number =>
  powered ? PRESSED_BUTTON_DEPTH : BUTTON_DEPTH

const buttonPlateBoundsOf = (
  position: BlockPosition,
  face: 'floor' | 'ceiling',
  depth: number,
): BoxBounds => {
  const [lx, y, lz] = position
  if (face === 'floor') {
    return {
      minX: lx + WALL_BUTTON_MIN_Y,
      maxX: lx + WALL_BUTTON_MAX_Y,
      minY: y,
      maxY: y + depth,
      minZ: lz + WALL_BUTTON_MIN_Y,
      maxZ: lz + WALL_BUTTON_MAX_Y,
    }
  }
  return {
    minX: lx + WALL_BUTTON_MIN_Y,
    maxX: lx + WALL_BUTTON_MAX_Y,
    minY: y + UNIT_SIZE - depth,
    maxY: y + UNIT_SIZE,
    minZ: lz + WALL_BUTTON_MIN_Y,
    maxZ: lz + WALL_BUTTON_MAX_Y,
  }
}

const buttonWallBoundsOf = (position: BlockPosition, facing: HorizontalFacing, depth: number): BoxBounds => {
  const [lx, y, lz] = position
  const minY = y + WALL_BUTTON_MIN_Y
  const maxY = y + WALL_BUTTON_MAX_Y
  if (facing === 'west') {
    return { minX: lx, maxX: lx + depth, minY, maxY, minZ: lz + WALL_BUTTON_MIN_Y, maxZ: lz + WALL_BUTTON_MAX_Y }
  }
  if (facing === 'east') {
    return { minX: lx + UNIT_SIZE - depth, maxX: lx + UNIT_SIZE, minY, maxY, minZ: lz + WALL_BUTTON_MIN_Y, maxZ: lz + WALL_BUTTON_MAX_Y }
  }
  if (facing === 'north') {
    return { minX: lx + WALL_BUTTON_MIN_Y, maxX: lx + WALL_BUTTON_MAX_Y, minY, maxY, minZ: lz, maxZ: lz + depth }
  }
  return { minX: lx + WALL_BUTTON_MIN_Y, maxX: lx + WALL_BUTTON_MAX_Y, minY, maxY, minZ: lz + UNIT_SIZE - depth, maxZ: lz + UNIT_SIZE }
}

const buttonBoundsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  face: NonNullable<EffectiveBlockStateValues['face']>,
  depth: number,
): BoxBounds => face === 'wall'
  ? buttonWallBoundsOf(position, facing, depth)
  : buttonPlateBoundsOf(position, face, depth)

const meshStoneButtonCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(attachedGeometryStateOf(blockId, blockState), ({ facing, face, powered }) =>
    meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind: 'stoneButton', position, blockState, config, geometryBoundsOf },
      buttonBoundsOf(position, facing, face, poweredDepthOf(powered)),
    ),
  )
}

const HORIZONTAL_OFFSET_FACTORS: Readonly<Record<HorizontalFacing, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
}

const horizontalOffsetForFacing = (facing: HorizontalFacing, distance: number): readonly [number, number] => {
  const [dx, dz] = HORIZONTAL_OFFSET_FACTORS[facing]
  return [dx * distance, dz * distance]
}

const leverBaseBoundsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  face: NonNullable<EffectiveBlockStateValues['face']>,
): BoxBounds => {
  const [lx, y, lz] = position
  if (face === 'floor') {
    return { minX: lx + WALL_BUTTON_MIN_Y, maxX: lx + WALL_BUTTON_MAX_Y, minY: y, maxY: y + REPEATER_BASE_HEIGHT, minZ: lz + WALL_BUTTON_MIN_Y, maxZ: lz + WALL_BUTTON_MAX_Y }
  }
  if (face === 'ceiling') {
    return { minX: lx + WALL_BUTTON_MIN_Y, maxX: lx + WALL_BUTTON_MAX_Y, minY: y + UNIT_SIZE - REPEATER_BASE_HEIGHT, maxY: y + UNIT_SIZE, minZ: lz + WALL_BUTTON_MIN_Y, maxZ: lz + WALL_BUTTON_MAX_Y }
  }
  const minY = y + WALL_BUTTON_MIN_Y
  const maxY = y + WALL_BUTTON_MAX_Y
  if (facing === 'west') {
    return { minX: lx, maxX: lx + REPEATER_BASE_HEIGHT, minY, maxY, minZ: lz + WALL_BUTTON_MIN_Y, maxZ: lz + WALL_BUTTON_MAX_Y }
  }
  if (facing === 'east') {
    return { minX: lx + UNIT_SIZE - REPEATER_BASE_HEIGHT, maxX: lx + UNIT_SIZE, minY, maxY, minZ: lz + WALL_BUTTON_MIN_Y, maxZ: lz + WALL_BUTTON_MAX_Y }
  }
  if (facing === 'north') {
    return { minX: lx + WALL_BUTTON_MIN_Y, maxX: lx + WALL_BUTTON_MAX_Y, minY, maxY, minZ: lz, maxZ: lz + REPEATER_BASE_HEIGHT }
  }
  return { minX: lx + WALL_BUTTON_MIN_Y, maxX: lx + WALL_BUTTON_MAX_Y, minY, maxY, minZ: lz + UNIT_SIZE - REPEATER_BASE_HEIGHT, maxZ: lz + UNIT_SIZE }
}

const horizontalLeverHandleBoundsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  face: 'floor' | 'ceiling',
  powered: boolean,
): BoxBounds => {
  const [lx, y, lz] = position
  const [offsetX, offsetZ] = horizontalOffsetForFacing(facing, powered ? -LEVER_HANDLE_LENGTH / 2 : LEVER_HANDLE_LENGTH / 2)
  const baseY = face === 'floor' ? y + REPEATER_BASE_HEIGHT : y + UNIT_SIZE - REPEATER_BASE_HEIGHT
  const handleHeight = powered ? LEVER_HANDLE_HEIGHT / 2 : LEVER_HANDLE_HEIGHT
  const minY = face === 'floor' ? baseY : baseY - handleHeight
  const maxY = face === 'floor' ? baseY + handleHeight : baseY
  const centerX = lx + UNIT_SIZE / 2 + offsetX
  const centerZ = lz + UNIT_SIZE / 2 + offsetZ
  const lengthAxis = facing === 'north' || facing === 'south' ? 'z' : 'x'
  return {
    minX: centerX - (lengthAxis === 'x' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
    maxX: centerX + (lengthAxis === 'x' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
    minY,
    maxY,
    minZ: centerZ - (lengthAxis === 'z' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
    maxZ: centerZ + (lengthAxis === 'z' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
  }
}

const wallLeverHandleBoundsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  powered: boolean,
): BoxBounds => {
  const [lx, y, lz] = position
  const depth = REPEATER_BASE_HEIGHT
  const [centerOffsetX, centerOffsetZ] = horizontalOffsetForFacing(facing, -depth - LEVER_HANDLE_LENGTH / 2)
  const centerX = lx + UNIT_SIZE / 2 + centerOffsetX
  const centerZ = lz + UNIT_SIZE / 2 + centerOffsetZ
  const lengthAxis = facing === 'north' || facing === 'south' ? 'z' : 'x'
  const height = powered ? LEVER_HANDLE_HEIGHT / 2 : LEVER_HANDLE_HEIGHT
  return {
    minX: centerX - (lengthAxis === 'x' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
    maxX: centerX + (lengthAxis === 'x' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
    minY: y + WALL_BUTTON_CENTER - height / 2,
    maxY: y + WALL_BUTTON_CENTER + height / 2,
    minZ: centerZ - (lengthAxis === 'z' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
    maxZ: centerZ + (lengthAxis === 'z' ? LEVER_HANDLE_LENGTH : LEVER_HANDLE_WIDTH) / 2,
  }
}

const leverHandleBoundsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  face: NonNullable<EffectiveBlockStateValues['face']>,
  powered: boolean,
): BoxBounds => face === 'wall'
  ? wallLeverHandleBoundsOf(position, facing, powered)
  : horizontalLeverHandleBoundsOf(position, facing, face, powered)

const meshLeverCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(attachedGeometryStateOf(blockId, blockState), ({ facing, face, powered }) => {
    const context: SpecialShapeContext = { result, lookup, chunk, neighbours, blockId, kind: 'lever', position, blockState, config, geometryBoundsOf }
    return Result.flatMap(meshBoxCell(context, leverBaseBoundsOf(position, facing, face)), () =>
      meshBoxCell(context, leverHandleBoundsOf(position, facing, face, powered)),
    )
  })
}

const repeaterBaseBoundsOf = (position: BlockPosition): BoxBounds => {
  const [lx, y, lz] = position
  return { ...fullBlockBounds(lx, y, lz), maxY: y + REPEATER_BASE_HEIGHT }
}

const repeaterLockBoundsOf = (position: BlockPosition, facing: HorizontalFacing): ReadonlyArray<BoxBounds> => {
  const [lx, y, lz] = position
  const lockOnX = facing === 'north' || facing === 'south'
  return [GRID_COORD_MIN, GRID_COORD_MAX].map((side) => {
    const markerMin = side === GRID_COORD_MIN ? UNIT_ORIGIN : UNIT_SIZE - REPEATER_TORCH_SIZE
    const markerMax = side === GRID_COORD_MIN ? REPEATER_TORCH_SIZE : UNIT_SIZE
    return {
      minX: lx + (lockOnX ? markerMin : UNIT_SIZE / 2 - REPEATER_TORCH_SIZE / 2),
      maxX: lx + (lockOnX ? markerMax : UNIT_SIZE / 2 + REPEATER_TORCH_SIZE / 2),
      minY: y + REPEATER_BASE_HEIGHT,
      maxY: y + REPEATER_BASE_HEIGHT + REPEATER_TORCH_HEIGHT / 2,
      minZ: lz + (lockOnX ? UNIT_SIZE / 2 - REPEATER_TORCH_SIZE / 2 : markerMin),
      maxZ: lz + (lockOnX ? UNIT_SIZE / 2 + REPEATER_TORCH_SIZE / 2 : markerMax),
    }
  })
}

const stairBoundsOf = (
  blockId: BlockId,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> => {
  return Result.map(stairModelStateOf(state, blockId), ({ facing, half, shape }) => {
    const occupied = stairOccupiedCells(facing, half, shape)
    return [...occupied].map((cell) => {
      const gridX = cell % GRID_SIZE
      const gridZ = Math.floor(cell / GRID_SIZE) % GRID_SIZE
      const gridY = Math.floor(cell / (GRID_SIZE * GRID_SIZE))
      return boundsAtGridCell(0, 0, 0, gridX, gridY, gridZ)
    })
  })
}

const doorGeometryBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> => {
  return Result.map(doorModelStateOf(state, blockId), ({ normal }) => [doorBoundsOf(position, normal)])
}

const buttonGeometryBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> =>
  Result.map(attachedGeometryStateOf(blockId, state), ({ facing, face, powered }) => [
    buttonBoundsOf(position, facing, face, poweredDepthOf(powered)),
  ])

const leverGeometryBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> =>
  Result.map(attachedGeometryStateOf(blockId, state), ({ facing, face, powered }) => [
    leverBaseBoundsOf(position, facing, face),
    leverHandleBoundsOf(position, facing, face, powered),
  ])

type RepeaterModelState = {
  readonly facing: HorizontalFacing
  readonly delay: number
  readonly locked: boolean
}

const repeaterModelStateOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<RepeaterModelState, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const delay = requiredStateProperty(state.delay, blockId, 'delay')
  if (Result.isFailure(delay)) return Result.fail(delay.failure)
  if (delay.success < 1 || delay.success > 4) {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'delay' })
  }
  const locked = requiredStateProperty(state.locked, blockId, 'locked')
  if (Result.isFailure(locked)) return Result.fail(locked.failure)
  if (typeof locked.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'locked' })
  }
  return Result.succeed({ facing: facing.success, delay: delay.success, locked: locked.success })
}

const repeaterGeometryBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> => {
  return Result.map(repeaterModelStateOf(state, blockId), ({ facing, locked }) => [
    repeaterBaseBoundsOf(position),
    ...(locked ? repeaterLockBoundsOf(position, facing) : []),
  ])
}

const stairGeometryBoundsOf = (
  blockId: BlockId,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<BoxBounds>, SpecialMeshFailure> => {
  const [lx, y, lz] = position
  return Result.map(stairBoundsOf(blockId, state), (bounds) => bounds.map((cell) => ({
    minX: cell.minX + lx,
    maxX: cell.maxX + lx,
    minY: cell.minY + y,
    maxY: cell.maxY + y,
    minZ: cell.minZ + lz,
    maxZ: cell.maxZ + lz,
  })))
}

const SPECIAL_GEOMETRY_BOUNDS: SpecialGeometryBoundsResolver = {
  cactus: (_blockId, [lx, y, lz]) => Result.succeed([boxBoundsFor('cactus', lx, y, lz)]),
  slab: (blockId, position, state) => Result.map(slabTypeOf(state, blockId), (type) => [slabBoundsOf(position, type)]),
  pressurePlate: (blockId, position, state) =>
    Result.map(pressurePlatePoweredOf(state, blockId), (powered) => [pressurePlateBoundsOf(position, powered)]),
  door: doorGeometryBoundsOf,
  stairs: stairGeometryBoundsOf,
  ladder: (blockId, position, state) =>
    Result.map(horizontalFacingOf(state, blockId), (facing) => [directionalThinBounds(position, facing, LADDER_THICKNESS)]),
  stoneButton: buttonGeometryBoundsOf,
  lever: leverGeometryBoundsOf,
  repeater: repeaterGeometryBoundsOf,
  snowLayer: (blockId, position, state) => Result.map(snowLayerBoundsOf(blockId, position, state), (bounds) => [bounds]),
}

const meshRepeaterTorchCells = (
  context: SpecialShapeContext,
  facing: HorizontalFacing,
  delay: number,
): void => {
  const [lx, y, lz] = context.position
  const separation = TORCH_BASE_INSET + delay * TORCH_DELAY_STEP
  const torchCenters = [UNIT_SIZE / 2 - separation / 2, UNIT_SIZE / 2 + separation / 2]
  for (const axisPosition of torchCenters) {
    const alongZ = facing === 'north' || facing === 'south'
    const centerX = alongZ ? lx + UNIT_SIZE / 2 : lx + axisPosition
    const centerZ = alongZ ? lz + axisPosition : lz + UNIT_SIZE / 2
    const bounds: BoxBounds = {
      minX: centerX - REPEATER_TORCH_SIZE / 2,
      maxX: centerX + REPEATER_TORCH_SIZE / 2,
      minY: y + REPEATER_TORCH_BASE,
      maxY: y + REPEATER_TORCH_BASE + REPEATER_TORCH_HEIGHT,
      minZ: centerZ - REPEATER_TORCH_SIZE / 2,
      maxZ: centerZ + REPEATER_TORCH_SIZE / 2,
    }
    for (const face of FACES) {
      context.result.push(
        makeBoxQuad(
          context.blockId,
          context.kind,
          face,
          bounds,
          quadLightAt(context.chunk, context.neighbours, face.direction, lx, y, lz),
          context.blockState,
        ),
      )
    }
  }
}

const meshRepeaterLockMarkers = (
  context: SpecialShapeContext,
  facing: HorizontalFacing,
  locked: boolean,
): Result.Result<void, SpecialMeshFailure> => {
  if (!locked) {
    return Result.void
  }
  for (const bounds of repeaterLockBoundsOf(context.position, facing)) {
    const meshed = meshBoxCell(context, bounds)
    if (Result.isFailure(meshed)) {
      return Result.fail(meshed.failure)
    }
  }
  return Result.void
}

const meshRepeaterCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  const { config, boundsOf: geometryBoundsOf } = geometry
  return Result.flatMap(repeaterModelStateOf(blockState, blockId), ({ facing, delay, locked }) => {
    const context: SpecialShapeContext = { result, lookup, chunk, neighbours, blockId, kind: 'repeater', position, blockState, config, geometryBoundsOf }
    const lockMarkerQuads: Array<SpecialBlockQuad> = []
    const lockMarkerContext = { ...context, result: lockMarkerQuads }
    return Result.flatMap(meshRepeaterLockMarkers(lockMarkerContext, facing, locked), () =>
      Result.flatMap(meshBoxCell(context, repeaterBaseBoundsOf(position)), () => {
        meshRepeaterTorchCells(context, facing, delay)
        context.result.push(...lockMarkerQuads)
        return Result.void
      }),
    )
  })
}

const meshRailCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = position
  const stateShape = railShapeFromState(blockState.shape, blockId)
  if (Result.isFailure(stateShape)) {
    return Result.fail(stateShape.failure)
  }
  let railShape = stateShape.success
  let outputState = blockState
  let legacyShape: RailShape | undefined
  if (typeof chunk.blockStates === 'undefined') {
    const legacySidecar = railShapeAt(
      Option.fromNullishOr(chunk.railShapes),
      blockIndex(lx, y, lz, chunk.height),
    )
    if (Result.isFailure(legacySidecar)) {
      return Result.fail(legacySidecar.failure)
    }
    if (Option.isSome(legacySidecar.success)) {
      railShape = legacySidecar.success.value
      legacyShape = legacySidecar.success.value
      outputState = { ...blockState, shape: railShape }
    }
  }
  const quads = railQuads(
    lookup,
    blockId,
    position,
    railShape,
    outputState,
    legacyShape,
    quadLightAt(chunk, neighbours, 'yPos', lx, y, lz),
    quadLightAt(chunk, neighbours, 'yNeg', lx, y, lz),
  )
  if (Result.isFailure(quads)) {
    return Result.fail(quads.failure)
  }
  result.push(...quads.success)
  return Result.void
}

const WIRE_DIRECTIONS: ReadonlyArray<HorizontalConnection> = ['north', 'east', 'south', 'west']

const wireBoundsOf = (
  position: BlockPosition,
  direction: HorizontalConnection | 'center',
): BoxBounds => {
  const [lx, y, lz] = position
  const minInset = UNIT_SIZE / 2 - WIRE_EDGE_INSET
  const maxInset = UNIT_SIZE / 2 + WIRE_EDGE_INSET
  const top = y + WIRE_HEIGHT
  if (direction === 'center') {
    return { minX: lx + minInset, maxX: lx + maxInset, minY: top, maxY: top, minZ: lz + minInset, maxZ: lz + maxInset }
  }
  if (direction === 'north') {
    return { minX: lx + minInset, maxX: lx + maxInset, minY: top, maxY: top, minZ: lz, maxZ: lz + minInset }
  }
  if (direction === 'south') {
    return { minX: lx + minInset, maxX: lx + maxInset, minY: top, maxY: top, minZ: lz + maxInset, maxZ: lz + UNIT_SIZE }
  }
  if (direction === 'west') {
    return { minX: lx, maxX: lx + minInset, minY: top, maxY: top, minZ: lz + minInset, maxZ: lz + maxInset }
  }
  return { minX: lx + maxInset, maxX: lx + UNIT_SIZE, minY: top, maxY: top, minZ: lz + minInset, maxZ: lz + maxInset }
}

type UpWireVertices = readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex]
type UpWireVertexFactory = (
  lx: number,
  lz: number,
  minInset: number,
  maxInset: number,
  low: number,
  high: number,
) => UpWireVertices

const UP_WIRE_VERTEX_FACTORIES: Readonly<Record<HorizontalConnection, UpWireVertexFactory>> = {
  north: (lx, lz, minInset, maxInset, low, high) => [
    [lx + maxInset, low, lz + minInset],
    [lx + maxInset, high, lz],
    [lx + minInset, high, lz],
    [lx + minInset, low, lz + minInset],
  ],
  east: (lx, lz, minInset, maxInset, low, high) => [
    [lx + maxInset, low, lz + maxInset],
    [lx + UNIT_SIZE, high, lz + maxInset],
    [lx + UNIT_SIZE, high, lz + minInset],
    [lx + maxInset, low, lz + minInset],
  ],
  south: (lx, lz, minInset, maxInset, low, high) => [
    [lx + minInset, low, lz + maxInset],
    [lx + minInset, high, lz + UNIT_SIZE],
    [lx + maxInset, high, lz + UNIT_SIZE],
    [lx + maxInset, low, lz + maxInset],
  ],
  west: (lx, lz, minInset, maxInset, low, high) => [
    [lx + minInset, low, lz + minInset],
    [lx, high, lz + minInset],
    [lx, high, lz + maxInset],
    [lx + minInset, low, lz + maxInset],
  ],
}

const upWireVerticesOf = (
  position: BlockPosition,
  direction: HorizontalConnection,
): UpWireVertices => {
  const [lx, y, lz] = position
  const minInset = UNIT_SIZE / 2 - WIRE_EDGE_INSET
  const maxInset = UNIT_SIZE / 2 + WIRE_EDGE_INSET
  const low = y + WIRE_HEIGHT
  const high = y + UNIT_SIZE + WIRE_HEIGHT
  return UP_WIRE_VERTEX_FACTORIES[direction](lx, lz, minInset, maxInset, low, high)
}

const wireQuad = (
  blockId: BlockId,
  vertices: readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex],
  blockState: EffectiveBlockStateValues,
  light: QuadLight | undefined,
): SpecialBlockQuad => ({
  blockId,
  kind: 'redstoneWire',
  vertices,
  ...TOP_FACE,
  ...lightPropertiesOf(light),
  blockState,
})

const meshRedstoneWireCell = (
  result: Array<SpecialBlockQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
): Result.Result<void, SpecialMeshFailure> => {
  const connections = requiredStateProperty(blockState.connections, blockId, 'connections')
  if (Result.isFailure(connections)) {
    return Result.fail(connections.failure)
  }
  const light = quadLightAt(chunk, neighbours, 'yPos', ...position)
  const centerBounds = wireBoundsOf(position, 'center')
  result.push(wireQuad(blockId, boxVertices(TOP_FACE, centerBounds), blockState, light))
  for (const direction of WIRE_DIRECTIONS) {
    const connection = connections.success[direction]
    if (connection !== 'none' && connection !== 'side' && connection !== 'up') {
      return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: `connections.${direction}` })
    }
    if (connection === 'none') {
      continue
    }
    const bounds = wireBoundsOf(position, direction)
    const vertices = connection === 'up' ? upWireVerticesOf(position, direction) : boxVertices(TOP_FACE, bounds)
    result.push(wireQuad(blockId, vertices, blockState, light))
  }
  return Result.void
}

const meshPlanarCell = (
  result: Array<SpecialBlockQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = position
  result.push(
    lilyPadQuad(
      blockId,
      lx,
      y,
      lz,
      quadLightAt(chunk, neighbours, 'yPos', lx, y, lz),
    ),
  )
  return Result.void
}

type ModelPart = {
  readonly bounds: BoxBounds
  readonly faces?: ReadonlyArray<FaceDirection>
}

type ModelPoint = readonly [x: number, y: number, z: number]
type ModelAxis = 'x' | 'y' | 'z'
type ModelEdge = 'min' | 'max'
type ModelAxisRange = readonly [min: number, max: number]

const modelPartAt = (
  position: BlockPosition,
  from: ModelPoint,
  to: ModelPoint,
  faces?: ReadonlyArray<FaceDirection>,
): ModelPart => {
  const [lx, y, lz] = position
  return {
    bounds: {
      minX: lx + from[0] / 16,
      maxX: lx + to[0] / 16,
      minY: y + from[1] / 16,
      maxY: y + to[1] / 16,
      minZ: lz + from[2] / 16,
      maxZ: lz + to[2] / 16,
    },
    ...(typeof faces === 'undefined' ? {} : { faces }),
  }
}

const MODEL_FACE_COVERAGE: Readonly<Record<FaceDirection, {
  readonly normalAxis: ModelAxis
  readonly edge: ModelEdge
  readonly tangentAxes: readonly [ModelAxis, ModelAxis]
}>> = {
  xNeg: { normalAxis: 'x', edge: 'min', tangentAxes: ['y', 'z'] },
  xPos: { normalAxis: 'x', edge: 'max', tangentAxes: ['y', 'z'] },
  yNeg: { normalAxis: 'y', edge: 'min', tangentAxes: ['x', 'z'] },
  yPos: { normalAxis: 'y', edge: 'max', tangentAxes: ['x', 'z'] },
  zNeg: { normalAxis: 'z', edge: 'min', tangentAxes: ['x', 'y'] },
  zPos: { normalAxis: 'z', edge: 'max', tangentAxes: ['x', 'y'] },
}

const MODEL_OPPOSITE_EDGE: Readonly<Record<ModelEdge, ModelEdge>> = { min: 'max', max: 'min' }

const MODEL_BOUNDS_RANGES: Readonly<Record<ModelAxis, (bounds: BoxBounds) => ModelAxisRange>> = {
  x: (bounds) => [bounds.minX, bounds.maxX],
  y: (bounds) => [bounds.minY, bounds.maxY],
  z: (bounds) => [bounds.minZ, bounds.maxZ],
}

const edgeIndexOf = (edge: ModelEdge): 0 | 1 => edge === 'min' ? 0 : 1

const modelPartHasCoveredFace = (
  bounds: BoxBounds,
  direction: FaceDirection,
  other: BoxBounds,
): boolean => {
  const { normalAxis, edge, tangentAxes } = MODEL_FACE_COVERAGE[direction]
  const plane = MODEL_BOUNDS_RANGES[normalAxis](bounds)[edgeIndexOf(edge)]
  const oppositePlane = MODEL_BOUNDS_RANGES[normalAxis](other)[edgeIndexOf(MODEL_OPPOSITE_EDGE[edge])]
  return plane === oppositePlane && tangentAxes.every((axis) => {
    const [min, max] = MODEL_BOUNDS_RANGES[axis](bounds)
    const [otherMin, otherMax] = MODEL_BOUNDS_RANGES[axis](other)
    return otherMin <= min && otherMax >= max
  })
}

const meshBlockModelParts = (
  result: Array<SpecialBlockQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  parts: ReadonlyArray<ModelPart>,
): void => {
  const [lx, y, lz] = position
  for (const [partIndex, part] of parts.entries()) {
    const directions = part.faces ?? FACES.map((face) => face.direction)
    for (const direction of directions) {
      const covered = parts.some((other, otherIndex) =>
        partIndex !== otherIndex && modelPartHasCoveredFace(part.bounds, direction, other.bounds),
      )
      if (covered) {
        continue
      }
      const face = faceOf(direction)
      result.push({
        blockId,
        kind: 'blockModel',
        vertices: boxVertices(face, part.bounds),
        ...face,
        ...lightPropertiesOf(quadLightAt(chunk, neighbours, direction, lx, y, lz)),
        blockState,
      })
    }
  }
}

const modelBooleanStateOf = (
  value: unknown,
  blockId: BlockId,
  property: InvalidBlockStateModelProperty,
): Result.Result<boolean, SpecialMeshFailure> => {
  const required = requiredStateProperty(value, blockId, property)
  if (Result.isFailure(required)) return Result.fail(required.failure)
  return typeof required.success === 'boolean'
    ? Result.succeed(required.success)
    : Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property })
}

const modelIntegerStateOf = (
  value: unknown,
  blockId: BlockId,
  property: InvalidBlockStateModelProperty,
  min: number,
  max: number,
): Result.Result<number, SpecialMeshFailure> => {
  const required = requiredStateProperty(value, blockId, property)
  if (Result.isFailure(required)) return Result.fail(required.failure)
  return typeof required.success === 'number' && Number.isInteger(required.success) && required.success >= min && required.success <= max
    ? Result.succeed(required.success)
    : Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property })
}

const modelFacingOf = (
  state: EffectiveBlockStateValues,
  blockId: BlockId,
): Result.Result<NonNullable<EffectiveBlockStateValues['facing']>, SpecialMeshFailure> => {
  const facing = requiredStateProperty(state.facing, blockId, 'facing')
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  return facing.success === 'north' || facing.success === 'east' || facing.success === 'south' ||
    facing.success === 'west' || facing.success === 'up' || facing.success === 'down'
    ? Result.succeed(facing.success)
    : Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'facing' })
}

const rotateModelPartY = (part: ModelPart, position: BlockPosition, turns: number): ModelPart => {
  const [lx, , lz] = position
  const localMinX = part.bounds.minX - lx
  const localMaxX = part.bounds.maxX - lx
  const localMinZ = part.bounds.minZ - lz
  const localMaxZ = part.bounds.maxZ - lz
  const rotated = turns % 4 === 0
    ? { minX: localMinX, maxX: localMaxX, minZ: localMinZ, maxZ: localMaxZ }
    : turns % 4 === 1
      ? { minX: 1 - localMaxZ, maxX: 1 - localMinZ, minZ: localMinX, maxZ: localMaxX }
      : turns % 4 === 2
        ? { minX: 1 - localMaxX, maxX: 1 - localMinX, minZ: 1 - localMaxZ, maxZ: 1 - localMinZ }
        : { minX: localMinZ, maxX: localMaxZ, minZ: 1 - localMaxX, maxZ: 1 - localMinX }
  return {
    ...part,
    bounds: {
      ...part.bounds,
      minX: lx + rotated.minX,
      maxX: lx + rotated.maxX,
      minZ: lz + rotated.minZ,
      maxZ: lz + rotated.maxZ,
    },
  }
}

type VanillaModelFaceName = 'down' | 'up' | 'north' | 'east' | 'south' | 'west'
type VanillaModelElement = {
  readonly from: ModelPoint
  readonly to: ModelPoint
  readonly faces: ReadonlyArray<VanillaModelFaceName>
}

const MODEL_ELEMENT_TILT_ORIGIN: ModelPoint = [0, 3.5, 8]
const MODEL_ELEMENT_TILT_ANGLE = -Math.PI / 8
const BLOCKSTATE_Y_TURNS: Readonly<Record<HorizontalFacing, number>> = { east: 0, north: 3, south: 1, west: 2 }
const VANILLA_FACE_GEOMETRY: Readonly<Record<VanillaModelFaceName, { readonly axis: 0 | 1 | 2; readonly edge: 0 | 1; readonly direction: FaceDirection }>> = {
  down: { axis: 1, edge: 0, direction: 'yNeg' },
  up: { axis: 1, edge: 1, direction: 'yPos' },
  north: { axis: 2, edge: 0, direction: 'zNeg' },
  east: { axis: 0, edge: 1, direction: 'xPos' },
  south: { axis: 2, edge: 1, direction: 'zPos' },
  west: { axis: 0, edge: 0, direction: 'xNeg' },
}

const rotateModelFaceY = (face: FaceDirection, turns: number): FaceDirection => {
  let direction = face
  for (let turn = 0; turn < turns; turn += 1) {
    direction = direction === 'xNeg' ? 'zNeg'
      : direction === 'zNeg' ? 'xPos'
        : direction === 'xPos' ? 'zPos'
          : direction === 'zPos' ? 'xNeg'
            : direction
  }
  return direction
}

const modelElementPartsAt = (
  position: BlockPosition,
  { from, to, faces }: VanillaModelElement,
  facing: HorizontalFacing,
): ReadonlyArray<ModelPart> => {
  const [originX, originY] = MODEL_ELEMENT_TILT_ORIGIN
  const cos = Math.cos(MODEL_ELEMENT_TILT_ANGLE)
  const sin = Math.sin(MODEL_ELEMENT_TILT_ANGLE)
  const turns = BLOCKSTATE_Y_TURNS[facing]
  const corners: ReadonlyArray<ModelPoint> = [
    [from[0], from[1], from[2]], [from[0], from[1], to[2]],
    [from[0], to[1], from[2]], [from[0], to[1], to[2]],
    [to[0], from[1], from[2]], [to[0], from[1], to[2]],
    [to[0], to[1], from[2]], [to[0], to[1], to[2]],
  ]
  const transformed = corners.map((corner) => {
    const [x, y, z] = corner
    const dx = x - originX
    const dy = y - originY
    const tiltedX = originX + cos * dx - sin * dy
    const tiltedY = originY + sin * dx + cos * dy
    const turned = turns === 0
      ? [tiltedX, tiltedY, z] as const
      : turns === 1
        ? [16 - z, tiltedY, tiltedX] as const
        : turns === 2
          ? [16 - tiltedX, tiltedY, 16 - z] as const
          : [z, tiltedY, 16 - tiltedX] as const
    return { corner, point: turned }
  })
  const [lx, y, lz] = position
  return faces.map((name) => {
    const face = VANILLA_FACE_GEOMETRY[name]
    const coordinate = from[face.axis] + (to[face.axis] - from[face.axis]) * face.edge
    const faceVertices = transformed
      .filter(({ corner }) => corner[face.axis] === coordinate)
      .map(({ point }) => point)
    return {
      bounds: {
        minX: lx + Math.min(...faceVertices.map(([x]) => x)) / 16,
        maxX: lx + Math.max(...faceVertices.map(([x]) => x)) / 16,
        minY: y + Math.min(...faceVertices.map(([, pointY]) => pointY)) / 16,
        maxY: y + Math.max(...faceVertices.map(([, pointY]) => pointY)) / 16,
        minZ: lz + Math.min(...faceVertices.map(([, , z]) => z)) / 16,
        maxZ: lz + Math.max(...faceVertices.map(([, , z]) => z)) / 16,
      },
      faces: [rotateModelFaceY(face.direction, turns)],
    }
  })
}

const standingTorchPartsOf = (position: BlockPosition): ReadonlyArray<ModelPart> => [
  modelPartAt(position, [7, 0, 7], [9, 10, 9]),
]

const REDSTONE_WALL_TORCH_ELEMENTS: ReadonlyArray<VanillaModelElement> = [
  { from: [-1, 3.5, 7], to: [1, 13.5, 9], faces: ['down', 'up', 'north', 'east', 'south', 'west'] },
  { from: [-1.5, 8, 6.5], to: [1.5, 11, 9.5], faces: ['up'] },
  { from: [-1.5, 14, 6.5], to: [1.5, 17, 9.5], faces: ['down'] },
  { from: [-1.5, 11, 3.5], to: [1.5, 14, 6.5], faces: ['south'] },
  { from: [1.5, 11, 6.5], to: [4.5, 14, 9.5], faces: ['west'] },
  { from: [-1.5, 11, 9.5], to: [1.5, 14, 12.5], faces: ['north'] },
  { from: [-4.5, 11, 6.5], to: [-1.5, 14, 9.5], faces: ['east'] },
]

const wallTorchPartsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  elements: ReadonlyArray<VanillaModelElement>,
): ReadonlyArray<ModelPart> => elements.flatMap((element) => modelElementPartsAt(position, element, facing))

const chestPartsOf = (
  position: BlockPosition,
  facing: HorizontalFacing,
  type: 'single' | 'left' | 'right',
): ReadonlyArray<ModelPart> => {
  const parts = [
    modelPartAt(position, [1, 0, 1], [15, 10, 15]),
    modelPartAt(position, [1, 9, 1], [15, 14, 15]),
  ]
  if (type === 'single') return parts
  const splitX = facing === 'north' || facing === 'south'
  const negativeSide = type === 'left'
    ? facing === 'north' || facing === 'east'
    : facing === 'south' || facing === 'west'
  const [lx, , lz] = position
  return parts.map((part) => {
    const { bounds } = part
    if (splitX) {
      const midpoint = lx + 0.5
      return {
        ...part,
        bounds: negativeSide
          ? { ...bounds, maxX: midpoint }
          : { ...bounds, minX: midpoint },
      }
    }
    const midpoint = lz + 0.5
    return {
      ...part,
      bounds: negativeSide
        ? { ...bounds, maxZ: midpoint }
        : { ...bounds, minZ: midpoint },
    }
  })
}

const BED_PILLOW_PARTS: Readonly<Record<HorizontalFacing, (position: BlockPosition) => ModelPart>> = {
  north: (position) => modelPartAt(position, [0, 5, 0], [16, 9, 4]),
  south: (position) => modelPartAt(position, [0, 5, 12], [16, 9, 16]),
  west: (position) => modelPartAt(position, [0, 5, 0], [4, 9, 16]),
  east: (position) => modelPartAt(position, [12, 5, 0], [16, 9, 16]),
}

const bedPillowPartOf = (position: BlockPosition, facing: HorizontalFacing): ModelPart =>
  BED_PILLOW_PARTS[facing](position)

const anvilPartsOf = (position: BlockPosition, facing: HorizontalFacing): ReadonlyArray<ModelPart> => {
  const turns: Readonly<Record<HorizontalFacing, number>> = { east: 0, south: 1, west: 2, north: 3 }
  const horizontalParts = [
    modelPartAt(position, [4, 4, 3], [12, 5, 13]),
    modelPartAt(position, [6, 5, 4], [10, 10, 12]),
    modelPartAt(position, [3, 10, 0], [13, 16, 16]),
  ]
  return [
    modelPartAt(position, [2, 0, 2], [14, 4, 14]),
    ...horizontalParts.map((part) => rotateModelPartY(part, position, turns[facing])),
  ]
}

const cauldronPartsOf = (position: BlockPosition): ReadonlyArray<ModelPart> => [
  modelPartAt(position, [2, 0, 2], [14, 3, 14]),
  modelPartAt(position, [0, 3, 0], [16, 16, 2]),
  modelPartAt(position, [0, 3, 14], [16, 16, 16]),
  modelPartAt(position, [0, 3, 2], [2, 16, 14]),
  modelPartAt(position, [14, 3, 2], [16, 16, 14]),
]

const hopperPartsOf = (position: BlockPosition, facing: NonNullable<EffectiveBlockStateValues['facing']>): ReadonlyArray<ModelPart> => {
  const parts: Array<ModelPart> = [
    modelPartAt(position, [0, 10, 0], [16, 11, 16]),
    modelPartAt(position, [0, 11, 0], [2, 16, 16]),
    modelPartAt(position, [14, 11, 0], [16, 16, 16]),
    modelPartAt(position, [2, 11, 0], [14, 16, 2]),
    modelPartAt(position, [2, 11, 14], [14, 16, 16]),
    modelPartAt(position, [4, 4, 4], [12, 10, 12]),
  ]
  const outlet = facing === 'down'
    ? modelPartAt(position, [6, 0, 6], [10, 4, 10])
    : facing === 'north'
      ? modelPartAt(position, [6, 4, 0], [10, 8, 4])
      : facing === 'south'
        ? modelPartAt(position, [6, 4, 12], [10, 8, 16])
        : facing === 'west'
          ? modelPartAt(position, [0, 4, 6], [4, 8, 10])
          : modelPartAt(position, [12, 4, 6], [16, 8, 10])
  parts.push(outlet)
  return parts
}

const endFramePartsOf = (position: BlockPosition, eye: boolean): ReadonlyArray<ModelPart> => {
  const parts: Array<ModelPart> = [
    modelPartAt(position, [0, 0, 0], [16, 13, 4]),
    modelPartAt(position, [0, 0, 12], [16, 13, 16]),
    modelPartAt(position, [0, 0, 4], [4, 13, 12]),
    modelPartAt(position, [12, 0, 4], [16, 13, 12]),
  ]
  if (eye) parts.push(modelPartAt(position, [4, 13, 4], [12, 16, 12]))
  return parts
}

type ModelFacing = NonNullable<EffectiveBlockStateValues['facing']>

const PISTON_HEAD_PARTS: Readonly<Record<ModelFacing, (position: BlockPosition, stemLength: number) => ReadonlyArray<ModelPart>>> = {
  up: (position, stemLength) => [
    modelPartAt(position, [6, 12 - stemLength, 6], [10, 12, 10]),
    modelPartAt(position, [0, 12, 0], [16, 16, 16]),
  ],
  down: (position, stemLength) => [
    modelPartAt(position, [6, 4, 6], [10, 4 + stemLength, 10]),
    modelPartAt(position, [0, 0, 0], [16, 4, 16]),
  ],
  north: (position, stemLength) => [
    modelPartAt(position, [6, 6, 4], [10, 10, 4 + stemLength]),
    modelPartAt(position, [0, 0, 0], [16, 16, 4]),
  ],
  south: (position, stemLength) => [
    modelPartAt(position, [6, 6, 12 - stemLength], [10, 10, 12]),
    modelPartAt(position, [0, 0, 12], [16, 16, 16]),
  ],
  west: (position, stemLength) => [
    modelPartAt(position, [4, 6, 6], [4 + stemLength, 10, 10]),
    modelPartAt(position, [0, 0, 0], [4, 16, 16]),
  ],
  east: (position, stemLength) => [
    modelPartAt(position, [12 - stemLength, 6, 6], [12, 10, 10]),
    modelPartAt(position, [12, 0, 0], [16, 16, 16]),
  ],
}

const pistonHeadPartsOf = (
  position: BlockPosition,
  facing: ModelFacing,
  short: boolean,
): ReadonlyArray<ModelPart> => PISTON_HEAD_PARTS[facing](position, short ? 8 : 12)

const PISTON_EXTENDED_BASE_BOUNDS: Readonly<Record<ModelFacing, readonly [ModelPoint, ModelPoint]>> = {
  up: [[0, 0, 0], [16, 12, 16]],
  down: [[0, 4, 0], [16, 16, 16]],
  north: [[0, 0, 4], [16, 16, 16]],
  south: [[0, 0, 0], [16, 16, 12]],
  west: [[4, 0, 0], [16, 16, 16]],
  east: [[0, 0, 0], [12, 16, 16]],
}

const pistonBaseModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = modelFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const extended = modelBooleanStateOf(state.extended, blockId, 'extended')
  if (Result.isFailure(extended)) return Result.fail(extended.failure)
  const [from, to]: readonly [ModelPoint, ModelPoint] = extended.success
    ? PISTON_EXTENDED_BASE_BOUNDS[facing.success]
    : [[0, 0, 0], [16, 16, 16]]
  return Result.succeed([modelPartAt(position, from, to)])
}

// For Wiki pages without model elements, use explicit visual estimates rather than collision bounds.
type BlockModelBuildContext = {
  readonly blockId: BlockId
  readonly blockType: BlockType
  readonly position: BlockPosition
  readonly state: EffectiveBlockStateValues
}

type BlockModelBuilder = (context: BlockModelBuildContext) => Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure>

const staticBlockModelBuilder = (
  partsOf: (position: BlockPosition) => ReadonlyArray<ModelPart>,
): BlockModelBuilder => ({ position }) => Result.succeed(partsOf(position))

const redstoneTorchModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const lit = modelBooleanStateOf(state.lit, blockId, 'lit')
  return Result.map(lit, () => [
    ...standingTorchPartsOf(position),
    modelPartAt(position, [6.5, 7.5, 6.5], [9.5, 10.5, 9.5]),
  ])
}

const redstoneWallTorchModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const lit = modelBooleanStateOf(state.lit, blockId, 'lit')
  return Result.map(lit, () => wallTorchPartsOf(position, facing.success, REDSTONE_WALL_TORCH_ELEMENTS))
}

const farmlandModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const moisture = modelIntegerStateOf(state.moisture, blockId, 'moisture', 0, 7)
  return Result.map(moisture, () => [modelPartAt(position, [0, 0, 0], [16, 15, 16])])
}

const chestModelPartsOf = ({ blockId, blockType, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  if (blockType === 'ender_chest') return Result.succeed(chestPartsOf(position, facing.success, 'single'))
  const type = requiredStateProperty(state.type, blockId, 'type')
  if (Result.isFailure(type)) return Result.fail(type.failure)
  if (type.success !== 'single' && type.success !== 'left' && type.success !== 'right') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'type' })
  }
  return Result.succeed(chestPartsOf(position, facing.success, type.success))
}

const bedModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const part = requiredStateProperty(state.part, blockId, 'part')
  if (Result.isFailure(part)) return Result.fail(part.failure)
  if (part.success !== 'head' && part.success !== 'foot') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'part' })
  }
  const occupied = modelBooleanStateOf(state.occupied, blockId, 'occupied')
  if (Result.isFailure(occupied)) return Result.fail(occupied.failure)
  const bedFeet: Readonly<Record<'head' | 'foot', ReadonlyArray<readonly [ModelPoint, ModelPoint]>>> = {
    head: [[[0, 0, 0], [3, 3, 3]], [[13, 0, 0], [16, 3, 3]]],
    foot: [[[0, 0, 13], [3, 3, 16]], [[13, 0, 13], [16, 3, 16]]],
  }
  const turns: Readonly<Record<HorizontalFacing, number>> = { north: 0, east: 1, south: 2, west: 3 }
  return Result.succeed([
    modelPartAt(position, [0, 3, 0], [16, 9, 16]),
    ...bedFeet[part.success].map(([from, to]) => rotateModelPartY(modelPartAt(position, from, to), position, turns[facing.success])),
    ...(part.success === 'head' ? [bedPillowPartOf(position, facing.success)] : []),
  ])
}

const anvilModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  return Result.map(facing, (value) => anvilPartsOf(position, value))
}

const waterCauldronModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const level = modelIntegerStateOf(state.level, blockId, 'level', 1, 3)
  if (Result.isFailure(level)) return Result.fail(level.failure)
  const waterHeight = 3 + level.success * 3
  return Result.succeed([
    ...cauldronPartsOf(position),
    modelPartAt(position, [4, 3, 4], [12, waterHeight, 12]),
  ])
}

const hopperModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = modelFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  if (facing.success === 'up') return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'facing' })
  const enabled = modelBooleanStateOf(state.enabled, blockId, 'enabled')
  return Result.map(enabled, () => hopperPartsOf(position, facing.success))
}

const comparatorModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const powered = modelBooleanStateOf(state.powered, blockId, 'powered')
  if (Result.isFailure(powered)) return Result.fail(powered.failure)
  const mode = requiredStateProperty(state.mode, blockId, 'mode')
  if (Result.isFailure(mode)) return Result.fail(mode.failure)
  if (mode.success !== 'compare' && mode.success !== 'subtract') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'mode' })
  }
  const baseParts = [
    modelPartAt(position, [0, 0, 0], [16, 2, 16]),
    modelPartAt(position, [6, 2, 6], [10, 4, 10]),
    modelPartAt(position, [4, 2, 3], [6, 7, 5]),
    modelPartAt(position, [10, 2, 3], [12, 7, 5]),
    modelPartAt(position, [7, 2, 11], [9, 6, 13]),
  ]
  const turns: Readonly<Record<HorizontalFacing, number>> = { north: 0, east: 1, south: 2, west: 3 }
  return Result.succeed(baseParts.map((part) => rotateModelPartY(part, position, turns[facing.success])))
}

const brewingStandModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const bottles: Array<boolean> = []
  for (const property of ['has_bottle_0', 'has_bottle_1', 'has_bottle_2'] as const) {
    const hasBottle = modelBooleanStateOf(state[property], blockId, property)
    if (Result.isFailure(hasBottle)) return Result.fail(hasBottle.failure)
    bottles.push(hasBottle.success)
  }
  const parts: Array<ModelPart> = [
    modelPartAt(position, [2, 0, 2], [14, 2, 14]),
    modelPartAt(position, [7, 2, 7], [9, 14, 9]),
    modelPartAt(position, [3, 2, 3], [13, 3, 13]),
    modelPartAt(position, [4, 2, 4], [6, 5, 6]),
    modelPartAt(position, [10, 2, 4], [12, 5, 6]),
    modelPartAt(position, [7, 2, 10], [9, 5, 12]),
  ]
  if (bottles[0]) parts.push(modelPartAt(position, [4, 3, 4], [7, 10, 7]))
  if (bottles[1]) parts.push(modelPartAt(position, [9, 3, 4], [12, 10, 7]))
  if (bottles[2]) parts.push(modelPartAt(position, [6, 3, 9], [10, 10, 13]))
  return Result.succeed(parts)
}

const endPortalFrameModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const eye = modelBooleanStateOf(state.eye, blockId, 'eye')
  return Result.map(eye, (value) => endFramePartsOf(position, value))
}

const END_ROD_PARTS: Readonly<Record<ModelFacing, (position: BlockPosition) => ReadonlyArray<ModelPart>>> = {
  up: (position) => [modelPartAt(position, [7, 0, 7], [9, 16, 9])],
  down: (position) => [modelPartAt(position, [7, 0, 7], [9, 16, 9])],
  east: (position) => [modelPartAt(position, [0, 7, 7], [16, 9, 9])],
  west: (position) => [modelPartAt(position, [0, 7, 7], [16, 9, 9])],
  north: (position) => [modelPartAt(position, [7, 7, 0], [9, 9, 16])],
  south: (position) => [modelPartAt(position, [7, 7, 0], [9, 9, 16])],
}

const endRodModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = modelFacingOf(state, blockId)
  return Result.map(facing, (value) => END_ROD_PARTS[value](position))
}

const pistonHeadModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const facing = modelFacingOf(state, blockId)
  if (Result.isFailure(facing)) return Result.fail(facing.failure)
  const short = modelBooleanStateOf(state.short, blockId, 'short')
  if (Result.isFailure(short)) return Result.fail(short.failure)
  const type = requiredStateProperty(state.type, blockId, 'type')
  if (Result.isFailure(type)) return Result.fail(type.failure)
  if (type.success !== 'normal' && type.success !== 'sticky') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'type' })
  }
  return Result.succeed(pistonHeadPartsOf(position, facing.success, short.success))
}

const netherPortalModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const axis = requiredStateProperty(state.axis, blockId, 'axis')
  if (Result.isFailure(axis)) return Result.fail(axis.failure)
  if (axis.success === 'x') return Result.succeed([modelPartAt(position, [0, 0, 8], [16, 16, 8], ['zNeg', 'zPos'])])
  if (axis.success === 'z') return Result.succeed([modelPartAt(position, [8, 0, 0], [8, 16, 16], ['xNeg', 'xPos'])])
  return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'axis' })
}

const FIRE_CONNECTION_PARTS: Readonly<Record<'north' | 'east' | 'south' | 'west' | 'up', (position: BlockPosition) => ModelPart>> = {
  north: (position) => modelPartAt(position, [0, 0, 0], [16, 16, 0], ['zNeg', 'zPos']),
  east: (position) => modelPartAt(position, [16, 0, 0], [16, 16, 16], ['xNeg', 'xPos']),
  south: (position) => modelPartAt(position, [0, 0, 16], [16, 16, 16], ['zNeg', 'zPos']),
  west: (position) => modelPartAt(position, [0, 0, 0], [0, 16, 16], ['xNeg', 'xPos']),
  up: (position) => modelPartAt(position, [2, 4, 2], [14, 16, 14], ['yNeg', 'yPos']),
}

const fireModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const age = modelIntegerStateOf(state.age, blockId, 'age', 0, 15)
  if (Result.isFailure(age)) return Result.fail(age.failure)
  const connections = requiredStateProperty(state.connections, blockId, 'connections')
  if (Result.isFailure(connections)) return Result.fail(connections.failure)
  const parts: Array<ModelPart> = [
    modelPartAt(position, [0, 0, 7], [16, 16, 9], ['xNeg', 'xPos']),
    modelPartAt(position, [7, 0, 0], [9, 16, 16], ['zNeg', 'zPos']),
  ]
  for (const direction of ['north', 'east', 'south', 'west', 'up'] as const) {
    const connected = connections.success[direction]
    if (typeof connected !== 'boolean') {
      return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: `connections.${direction}` })
    }
    if (connected) parts.push(FIRE_CONNECTION_PARTS[direction](position))
  }
  return Result.succeed(parts)
}

const witherSkullModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const powered = modelBooleanStateOf(state.powered, blockId, 'powered')
  if (Result.isFailure(powered)) return Result.fail(powered.failure)
  const rotation = modelIntegerStateOf(state.rotation, blockId, 'rotation', 0, 15)
  return Result.map(rotation, () => [modelPartAt(position, [4, 4, 4], [12, 12, 12])])
}

const chorusFlowerModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const age = modelIntegerStateOf(state.age, blockId, 'age', 0, 5)
  if (Result.isFailure(age)) return Result.fail(age.failure)
  return Result.succeed(age.success === 5
    ? [modelPartAt(position, [4, 0, 4], [12, 16, 12])]
    : [
        modelPartAt(position, [4, 0, 4], [12, 10, 12]),
        modelPartAt(position, [2, 10, 2], [14, 14, 14]),
        modelPartAt(position, [4, 14, 4], [12, 16, 12]),
      ])
}

const CHORUS_PLANT_ARMS: Readonly<Record<'down' | 'north' | 'east' | 'south' | 'west' | 'up', readonly [ModelPoint, ModelPoint]>> = {
  down: [[6, 0, 6], [10, 6, 10]],
  north: [[6, 6, 0], [10, 10, 6]],
  east: [[10, 6, 6], [16, 10, 10]],
  south: [[6, 6, 10], [10, 10, 16]],
  west: [[0, 6, 6], [6, 10, 10]],
  up: [[6, 10, 6], [10, 16, 10]],
}

const chorusPlantModelPartsOf = ({ blockId, position, state }: BlockModelBuildContext): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const connections = requiredStateProperty(state.connections, blockId, 'connections')
  if (Result.isFailure(connections)) return Result.fail(connections.failure)
  const parts: Array<ModelPart> = [modelPartAt(position, [6, 6, 6], [10, 10, 10])]
  for (const direction of ['down', 'north', 'east', 'south', 'west', 'up'] as const) {
    const connected = connections.success[direction]
    if (typeof connected !== 'boolean') {
      return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: `connections.${direction}` })
    }
    if (connected) parts.push(modelPartAt(position, ...CHORUS_PLANT_ARMS[direction]))
  }
  return Result.succeed(parts)
}

const SPECIAL_BLOCK_MODEL_BUILDERS: Readonly<Partial<Record<BlockType, BlockModelBuilder>>> = {
  torch: staticBlockModelBuilder(standingTorchPartsOf),
  redstone_torch: redstoneTorchModelPartsOf,
  redstone_wall_torch: redstoneWallTorchModelPartsOf,
  piston: pistonBaseModelPartsOf,
  sticky_piston: pistonBaseModelPartsOf,
  farmland: farmlandModelPartsOf,
  chest: chestModelPartsOf,
  ender_chest: chestModelPartsOf,
  bed: bedModelPartsOf,
  anvil: anvilModelPartsOf,
  cauldron: staticBlockModelBuilder(cauldronPartsOf),
  water_cauldron: waterCauldronModelPartsOf,
  hopper: hopperModelPartsOf,
  comparator: comparatorModelPartsOf,
  enchanting_table: staticBlockModelBuilder((position) => [
    modelPartAt(position, [0, 0, 0], [16, 3, 16]),
    modelPartAt(position, [3, 3, 3], [13, 10, 13]),
    modelPartAt(position, [0, 10, 0], [16, 12, 16]),
  ]),
  brewing_stand: brewingStandModelPartsOf,
  end_portal_frame: endPortalFrameModelPartsOf,
  end_portal_frame_filled: endPortalFrameModelPartsOf,
  end_rod: endRodModelPartsOf,
  piston_head: pistonHeadModelPartsOf,
  dragon_egg: staticBlockModelBuilder((position) => [
    modelPartAt(position, [5, 0, 5], [11, 4, 11]),
    modelPartAt(position, [2, 4, 2], [14, 12, 14]),
    modelPartAt(position, [4, 12, 4], [12, 16, 12]),
  ]),
  end_portal: staticBlockModelBuilder((position) => [modelPartAt(position, [0, 12, 0], [16, 12, 16], ['yNeg', 'yPos'])]),
  end_gateway: staticBlockModelBuilder((position) => [modelPartAt(position, [0, 12, 0], [16, 12, 16], ['yNeg', 'yPos'])]),
  nether_portal: netherPortalModelPartsOf,
  fire: fireModelPartsOf,
  wither_skeleton_skull: witherSkullModelPartsOf,
  chorus_flower: chorusFlowerModelPartsOf,
  chorus_plant: chorusPlantModelPartsOf,
  end_crystal: ({ blockId, blockType }) => Result.fail({ _tag: 'UnsupportedSpecialBlockModel', blockId, blockType }),
}

const blockModelPartsOf = (
  blockId: BlockId,
  blockType: BlockType,
  position: BlockPosition,
  state: EffectiveBlockStateValues,
): Result.Result<ReadonlyArray<ModelPart>, SpecialMeshFailure> => {
  const builder = SPECIAL_BLOCK_MODEL_BUILDERS[blockType]
  if (typeof builder === 'undefined') {
    return Result.fail({ _tag: 'UnsupportedSpecialBlockModel', blockId, blockType })
  }
  return builder({ blockId, blockType, position, state })
}

const meshBlockModelCell = (
  context: StatefulSpecialCellContext,
): Result.Result<void, SpecialMeshFailure> => {
  const blockType = blockTypeOfId(context.blockId)
  if (Result.isFailure(blockType)) return Result.fail(blockType.failure)
  if (typeof blockType.success === 'undefined') {
    return Result.fail({ _tag: 'MissingSpecialBlockType', blockId: context.blockId })
  }
  return Result.map(
    blockModelPartsOf(context.blockId, blockType.success, context.position, context.blockState),
    (parts) => {
      meshBlockModelParts(
        context.result,
        context.chunk,
        context.neighbours,
        context.blockId,
        context.position,
        context.blockState,
        parts,
      )
    },
  )
}

type StatefulSpecialRenderKind = Exclude<SpecialRenderKind, 'cactus' | 'lilyPad'>

type StatefulSpecialCellContext = {
  readonly result: Array<SpecialBlockQuad>
  readonly lookup: SpecialBlockLookup
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly blockId: BlockId
  readonly position: BlockPosition
  readonly blockState: EffectiveBlockStateValues
  readonly geometry: SpecialShapeGeometry
}

type StatefulSpecialMesher = (context: StatefulSpecialCellContext) => Result.Result<void, SpecialMeshFailure>

const STATEFUL_SPECIAL_MESHERS: Readonly<Record<StatefulSpecialRenderKind, StatefulSpecialMesher>> = {
  door: (context) => meshDoorCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  ladder: (context) => meshLadderCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  lever: (context) => meshLeverCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  pressurePlate: (context) => meshPressurePlateCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  rail: (context) => meshRailCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
  ),
  redstoneWire: (context) => meshRedstoneWireCell(
    context.result,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
  ),
  repeater: (context) => meshRepeaterCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  slab: (context) => meshSlabCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  stairs: (context) => meshStairsCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  stoneButton: (context) => meshStoneButtonCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  snowLayer: (context) => meshSnowLayerCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.geometry,
  ),
  blockModel: meshBlockModelCell,
}

const meshSpecialCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: SpecialRenderKind,
  position: BlockPosition,
  geometry: SpecialShapeGeometry,
): Result.Result<void, SpecialMeshFailure> => {
  if (kind === 'cactus') {
    const [lx, y, lz] = position
    return meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind, position, blockState: null, config: geometry.config, geometryBoundsOf: geometry.boundsOf },
      boxBoundsFor(kind, lx, y, lz),
    )
  }
  if (kind === 'lilyPad') {
    return meshPlanarCell(result, chunk, neighbours, blockId, position)
  }
  const state = blockStateAt(chunk, blockIndex(...position, chunk.height))
  if (Result.isFailure(state)) {
    return Result.fail(state.failure)
  }
  return STATEFUL_SPECIAL_MESHERS[kind]({ result, lookup, chunk, neighbours, blockId, position, blockState: state.success, geometry })
}

/** Meshes every special shape described by mc-kernel's registry. */
const REGION_X_INDEX = 0
const REGION_Y_INDEX = 1
const REGION_Z_INDEX = 2

type SpecialMeshBounds = {
  readonly minLx: number
  readonly minY: number
  readonly minLz: number
  readonly maxLx: number
  readonly maxY: number
  readonly maxLz: number
}

const specialMeshBoundsOf = (region: SpecialMeshRegion | undefined, yLimit: number): SpecialMeshBounds => ({
  maxLx: Math.min(region?.max[REGION_X_INDEX] ?? CHUNK_SIZE, CHUNK_SIZE),
  maxLz: Math.min(region?.max[REGION_Z_INDEX] ?? CHUNK_SIZE, CHUNK_SIZE),
  maxY: Math.min(region?.max[REGION_Y_INDEX] ?? yLimit, yLimit),
  minLx: Math.max(region?.min[REGION_X_INDEX] ?? UNIT_ORIGIN, UNIT_ORIGIN),
  minLz: Math.max(region?.min[REGION_Z_INDEX] ?? UNIT_ORIGIN, UNIT_ORIGIN),
  minY: Math.max(region?.min[REGION_Y_INDEX] ?? UNIT_ORIGIN, UNIT_ORIGIN),
})

export const meshSpecialBlocks = (
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  yLimit: number,
  region?: SpecialMeshRegion,
  config: MeshConfig = EMPTY_MESH_CONFIG,
): Result.Result<ReadonlyArray<SpecialBlockQuad>, SpecialMeshFailure> => {
  const { minLx, minY, minLz, maxLx, maxY, maxLz } = specialMeshBoundsOf(region, yLimit)
  const result: Array<SpecialBlockQuad> = []
  const geometry: SpecialShapeGeometry = { config, boundsOf: SPECIAL_GEOMETRY_BOUNDS }

  for (let lx = minLx; lx < maxLx; lx += UNIT_SIZE) {
    for (
      let lz = minLz,
        columnOffset = lx * chunk.height * CHUNK_SIZE + minLz * chunk.height;
      lz < maxLz;
      lz += UNIT_SIZE, columnOffset += UNIT_SIZE * chunk.height
    ) {
      for (let y = minY; y < maxY; y += UNIT_SIZE) {
        const blockId = blockIdAt(chunk.blocks, columnOffset + y)
        const registered = ensureRegisteredBlock(lookup, blockId, config)
        if (Option.isSome(registered)) {
          return Result.fail(registered.value)
        }
        const kind = specialKindOf(lookup, blockId)
        if (kind !== null) {
          const meshed = meshSpecialCell(
            result,
            lookup,
            chunk,
            neighbours,
            blockId,
            kind,
            [lx, y, lz],
            geometry,
          )
          if (Result.isFailure(meshed)) {
            return Result.fail(meshed.failure)
          }
        }
      }
    }
  }
  return Result.succeed(result)
}
