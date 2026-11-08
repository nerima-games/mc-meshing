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
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { FACES, type Face, type FaceDirection, type FaceFor, faceOf } from './faces.js'
import { type RailFaceDirection, railVerticesOf } from './rail-geometry.js'
import {
  type RailRenderKind,
  type RailRenderKindFailure,
  type RailSpecialBlockQuad,
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

type InvalidBlockStateModelProperty =
  | keyof EffectiveBlockStateValues
  | `connections.${keyof NonNullable<EffectiveBlockStateValues['connections']>}`

export type SpecialMeshFailure =
  | SpecialBlockLookupFailure
  | ChunkViewFailure
  | RailShapeFailure
  | { readonly _tag: 'MissingSpecialBlockLookupEntry'; readonly blockId: BlockId }
  | { readonly _tag: 'InvalidBlockStateModelProperty'; readonly blockId: BlockId; readonly property: InvalidBlockStateModelProperty }

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

type BoxRenderKind = Exclude<SpecialRenderKind, 'lilyPad' | 'rail'>
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

const isOpenToSpecial = (
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  kind: SpecialRenderKind,
  position: BlockPosition,
  face: Face,
  config: MeshConfig,
): boolean | SpecialMeshFailure => {
  const [lx, y, lz] = position
  const neighbourId = getBlockAcrossBoundary(
    chunk,
    neighbours,
    lx + face.nx,
    y + face.ny,
    lz + face.nz,
  )
  if (neighbourId === AIR) {
    return true
  }
  const opacityCode = lookup.opacityCodes[neighbourId]
  if (typeof opacityCode === 'undefined' || opacityCode === UNKNOWN_OPACITY_CODE) {
    if (isConfiguredBlock(config, neighbourId)) {
      return isConfiguredNonOpaqueBlock(config, neighbourId)
    }
    return missingSpecialBlockLookupEntry(neighbourId)
  }
  if (opacityCode === OPAQUE_OPACITY_CODE) {
    return false
  }
  return specialKindOf(lookup, neighbourId) !== kind
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

const boxFaceVisible = (context: SpecialShapeContext, bounds: BoxBounds, face: Face): Result.Result<boolean, SpecialMeshFailure> => {
  if (!boxFaceTouchesBlockBoundary(bounds, context.position, face.direction) && context.kind !== 'cactus') {
    return Result.succeed(true)
  }
  const open = isOpenToSpecial(
    context.lookup,
    context.chunk,
    context.neighbours,
    context.kind,
    context.position,
    face,
    context.config,
  )
  return typeof open === 'boolean' ? Result.succeed(open) : Result.fail(open)
}

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
    if (!visible.success) {
      continue
    }
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
  return Result.void
}

type RepeaterBoundaryVisibility = Readonly<Record<FaceDirection, boolean>>

const repeaterBoundaryVisibilityOf = (
  context: SpecialShapeContext,
  bounds: BoxBounds,
): Result.Result<RepeaterBoundaryVisibility, SpecialMeshFailure> => {
  const xNeg = boxFaceVisible(context, bounds, faceOf('xNeg'))
  if (Result.isFailure(xNeg)) return Result.fail(xNeg.failure)
  const xPos = boxFaceVisible(context, bounds, faceOf('xPos'))
  if (Result.isFailure(xPos)) return Result.fail(xPos.failure)
  const yNeg = boxFaceVisible(context, bounds, faceOf('yNeg'))
  if (Result.isFailure(yNeg)) return Result.fail(yNeg.failure)
  const zNeg = boxFaceVisible(context, bounds, faceOf('zNeg'))
  if (Result.isFailure(zNeg)) return Result.fail(zNeg.failure)
  const zPos = boxFaceVisible(context, bounds, faceOf('zPos'))
  if (Result.isFailure(zPos)) return Result.fail(zPos.failure)
  return Result.succeed({
    xNeg: xNeg.success,
    xPos: xPos.success,
    yNeg: yNeg.success,
    yPos: true,
    zNeg: zNeg.success,
    zPos: zPos.success,
  })
}

const meshRepeaterBoxCell = (
  context: SpecialShapeContext,
  bounds: BoxBounds,
  boundaryVisibility: RepeaterBoundaryVisibility,
): void => {
  const [lx, y, lz] = context.position
  for (const face of FACES) {
    if (boxFaceTouchesBlockBoundary(bounds, context.position, face.direction) && !boundaryVisibility[face.direction]) {
      continue
    }
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
): Result.Result<boolean, SpecialMeshFailure> => {
  if (voxelFaceIsInternal(occupied, gridX, gridY, gridZ, face)) {
    return Result.succeed(false)
  }
  if (!GRID_FACE_BOUNDARIES[face.direction](gridX, gridY, gridZ)) {
    return Result.succeed(true)
  }
  const open = isOpenToSpecial(context.lookup, context.chunk, context.neighbours, context.kind, context.position, face, context.config)
  return typeof open === 'boolean' ? Result.succeed(open) : Result.fail(open)
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
          const visible = voxelFaceVisible(context, occupied, gridX, gridY, gridZ, face)
          if (Result.isFailure(visible)) {
            return Result.fail(visible.failure)
          }
          if (!visible.success) {
            continue
          }
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
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  const half = blockState.half
  if (half !== 'bottom' && half !== 'top') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'half' })
  }
  const shape = stairShapeOf(blockState, blockId)
  if (Result.isFailure(shape)) {
    return Result.fail(shape.failure)
  }
  return meshVoxelShapeCell(
    { result, lookup, chunk, neighbours, blockId, kind: 'stairs', position, blockState, config },
    stairOccupiedCells(facing.success, half, shape.success),
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
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  const hinge = requiredStateProperty(blockState.hinge, blockId, 'hinge')
  if (Result.isFailure(hinge)) {
    return Result.fail(hinge.failure)
  }
  if (hinge.success !== 'left' && hinge.success !== 'right') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'hinge' })
  }
  const half = blockState.half
  if (half !== 'lower' && half !== 'upper') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'half' })
  }
  const open = requiredStateProperty(blockState.open, blockId, 'open')
  if (Result.isFailure(open)) {
    return Result.fail(open.failure)
  }
  if (typeof open.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'open' })
  }
  const normal = open.success ? doorHingeDirection(facing.success, hinge.success) : facing.success
  return meshBoxCell({ result, lookup, chunk, neighbours, blockId, kind: 'door', position, blockState, config }, doorBoundsOf(position, normal))
}

const meshSlabCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const slabType = requiredStateProperty(blockState.type, blockId, 'type')
  if (Result.isFailure(slabType)) {
    return Result.fail(slabType.failure)
  }
  const [lx, y, lz] = position
  let bounds: BoxBounds
  if (slabType.success === 'bottom') {
    bounds = { ...fullBlockBounds(lx, y, lz), maxY: y + SLAB_HEIGHT }
  } else if (slabType.success === 'top') {
    bounds = { ...fullBlockBounds(lx, y, lz), minY: y + SLAB_HEIGHT }
  } else if (slabType.success === 'double') {
    bounds = fullBlockBounds(lx, y, lz)
  } else {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'type' })
  }
  return meshBoxCell({ result, lookup, chunk, neighbours, blockId, kind: 'slab', position, blockState, config }, bounds)
}

const meshPressurePlateCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const powered = requiredStateProperty(blockState.powered, blockId, 'powered')
  if (Result.isFailure(powered)) {
    return Result.fail(powered.failure)
  }
  if (typeof powered.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'powered' })
  }
  const [lx, y, lz] = position
  const bounds = boxBoundsFor('pressurePlate', lx, y, lz)
  const pressedHeight = PRESSURE_PLATE_HEIGHT / 2
  return meshBoxCell(
    { result, lookup, chunk, neighbours, blockId, kind: 'pressurePlate', position, blockState, config },
    powered.success ? { ...bounds, maxY: y + pressedHeight } : bounds,
  )
}

const meshSnowLayerCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const layers = requiredStateProperty(blockState.layers, blockId, 'layers')
  if (Result.isFailure(layers)) {
    return Result.fail(layers.failure)
  }
  if (layers.success < 1 || layers.success > SNOW_LAYER_DIVISOR) {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'layers' })
  }
  const [lx, y, lz] = position
  return meshBoxCell(
    { result, lookup, chunk, neighbours, blockId, kind: 'snowLayer', position, blockState, config },
    { ...fullBlockBounds(lx, y, lz), maxY: y + layers.success / SNOW_LAYER_DIVISOR },
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
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  return meshBoxCell(
    { result, lookup, chunk, neighbours, blockId, kind: 'ladder', position, blockState, config },
    directionalThinBounds(position, facing.success, LADDER_THICKNESS),
  )
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
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  const face = requiredStateProperty(blockState.face, blockId, 'face')
  if (Result.isFailure(face)) {
    return Result.fail(face.failure)
  }
  if (face.success !== 'floor' && face.success !== 'wall' && face.success !== 'ceiling') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'face' })
  }
  const powered = requiredStateProperty(blockState.powered, blockId, 'powered')
  if (Result.isFailure(powered)) {
    return Result.fail(powered.failure)
  }
  if (typeof powered.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'powered' })
  }
  return meshBoxCell(
    { result, lookup, chunk, neighbours, blockId, kind: 'stoneButton', position, blockState, config },
    buttonBoundsOf(position, facing.success, face.success, poweredDepthOf(powered.success)),
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
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  const face = requiredStateProperty(blockState.face, blockId, 'face')
  if (Result.isFailure(face)) {
    return Result.fail(face.failure)
  }
  if (face.success !== 'floor' && face.success !== 'wall' && face.success !== 'ceiling') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'face' })
  }
  const powered = requiredStateProperty(blockState.powered, blockId, 'powered')
  if (Result.isFailure(powered)) {
    return Result.fail(powered.failure)
  }
  if (typeof powered.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'powered' })
  }
  const context: SpecialShapeContext = { result, lookup, chunk, neighbours, blockId, kind: 'lever', position, blockState, config }
  const base = meshBoxCell(context, leverBaseBoundsOf(position, facing.success, face.success))
  if (Result.isFailure(base)) {
    return Result.fail(base.failure)
  }
  return meshBoxCell(context, leverHandleBoundsOf(position, facing.success, face.success, powered.success))
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
  boundaryVisibility: RepeaterBoundaryVisibility,
): void => {
  if (!locked) {
    return
  }
  const [lx, y, lz] = context.position
  const lockOnX = facing === 'north' || facing === 'south'
  for (const side of [GRID_COORD_MIN, GRID_COORD_MAX]) {
    const markerMin = side === GRID_COORD_MIN ? UNIT_ORIGIN : UNIT_SIZE - REPEATER_TORCH_SIZE
    const markerMax = side === GRID_COORD_MIN ? REPEATER_TORCH_SIZE : UNIT_SIZE
    meshRepeaterBoxCell(context, {
      minX: lx + (lockOnX ? markerMin : UNIT_SIZE / 2 - REPEATER_TORCH_SIZE / 2),
      maxX: lx + (lockOnX ? markerMax : UNIT_SIZE / 2 + REPEATER_TORCH_SIZE / 2),
      minY: y + REPEATER_BASE_HEIGHT,
      maxY: y + REPEATER_BASE_HEIGHT + REPEATER_TORCH_HEIGHT / 2,
      minZ: lz + (lockOnX ? UNIT_SIZE / 2 - REPEATER_TORCH_SIZE / 2 : markerMin),
      maxZ: lz + (lockOnX ? UNIT_SIZE / 2 + REPEATER_TORCH_SIZE / 2 : markerMax),
    }, boundaryVisibility)
  }
}

const meshRepeaterCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const facing = horizontalFacingOf(blockState, blockId)
  if (Result.isFailure(facing)) {
    return Result.fail(facing.failure)
  }
  const delay = requiredStateProperty(blockState.delay, blockId, 'delay')
  if (Result.isFailure(delay)) {
    return Result.fail(delay.failure)
  }
  if (delay.success < 1 || delay.success > 4) {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'delay' })
  }
  const locked = requiredStateProperty(blockState.locked, blockId, 'locked')
  if (Result.isFailure(locked)) {
    return Result.fail(locked.failure)
  }
  if (typeof locked.success !== 'boolean') {
    return Result.fail({ _tag: 'InvalidBlockStateModelProperty', blockId, property: 'locked' })
  }
  const [lx, y, lz] = position
  const context: SpecialShapeContext = { result, lookup, chunk, neighbours, blockId, kind: 'repeater', position, blockState, config }
  const baseBounds = { ...fullBlockBounds(lx, y, lz), maxY: y + REPEATER_BASE_HEIGHT }
  const boundaryVisibility = repeaterBoundaryVisibilityOf(context, baseBounds)
  if (Result.isFailure(boundaryVisibility)) {
    return Result.fail(boundaryVisibility.failure)
  }
  meshRepeaterBoxCell(context, baseBounds, boundaryVisibility.success)
  meshRepeaterTorchCells(context, facing.success, delay.success)
  meshRepeaterLockMarkers(context, facing.success, locked.success, boundaryVisibility.success)
  return Result.void
}

const meshRailCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  position: BlockPosition,
  blockState: EffectiveBlockStateValues,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = position
  const open = isOpenToSpecial(lookup, chunk, neighbours, 'rail', position, TOP_FACE, config)
  if (typeof open !== 'boolean') {
    return Result.fail(open)
  }
  if (!open) {
    return Result.void
  }
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
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: 'lilyPad',
  position: BlockPosition,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = position
  const open = isOpenToSpecial(lookup, chunk, neighbours, kind, position, TOP_FACE, config)
  if (typeof open !== 'boolean') {
    return Result.fail(open)
  }
  if (!open) {
    return Result.void
  }
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

type StatefulSpecialRenderKind = Exclude<SpecialRenderKind, 'cactus' | 'lilyPad'>

type StatefulSpecialCellContext = {
  readonly result: Array<SpecialBlockQuad>
  readonly lookup: SpecialBlockLookup
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly blockId: BlockId
  readonly position: BlockPosition
  readonly blockState: EffectiveBlockStateValues
  readonly config: MeshConfig
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
    context.config,
  ),
  ladder: (context) => meshLadderCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
  lever: (context) => meshLeverCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
  pressurePlate: (context) => meshPressurePlateCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
  rail: (context) => meshRailCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
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
    context.config,
  ),
  slab: (context) => meshSlabCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
  stairs: (context) => meshStairsCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
  stoneButton: (context) => meshStoneButtonCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
  snowLayer: (context) => meshSnowLayerCell(
    context.result,
    context.lookup,
    context.chunk,
    context.neighbours,
    context.blockId,
    context.position,
    context.blockState,
    context.config,
  ),
}

const meshSpecialCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: SpecialRenderKind,
  position: BlockPosition,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  if (kind === 'cactus') {
    const [lx, y, lz] = position
    return meshBoxCell(
      { result, lookup, chunk, neighbours, blockId, kind, position, blockState: null, config },
      boxBoundsFor(kind, lx, y, lz),
    )
  }
  if (kind === 'lilyPad') {
    return meshPlanarCell(result, lookup, chunk, neighbours, blockId, kind, position, config)
  }
  const state = blockStateAt(chunk, blockIndex(...position, chunk.height))
  if (Result.isFailure(state)) {
    return Result.fail(state.failure)
  }
  return STATEFUL_SPECIAL_MESHERS[kind]({ result, lookup, chunk, neighbours, blockId, position, blockState: state.success, config })
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
            config,
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
