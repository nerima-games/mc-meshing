import { Option, Result } from 'effect'
import type { CollisionShape, RenderKind } from '@nerima-games/mc-kernel'
import type { BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel/domain/block-registry'
import { AIR, type BlockId, MAX_BLOCK_ID, blockIdAt } from './block-data.js'
import {
  BLOCK_IDS,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  blockIndex,
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

const SPECIAL_KIND_CODE = {
  cactus: CACTUS_KIND_CODE,
  lilyPad: LILY_PAD_KIND_CODE,
  pressurePlate: PRESSURE_PLATE_KIND_CODE,
  rail: RAIL_KIND_CODE,
  slab: SLAB_KIND_CODE,
} as const satisfies Record<SpecialRenderKind, number>

const UNIT_ORIGIN = 0
const UNIT_SIZE = 1
const BLOCK_MODEL_SUBDIVISIONS = 16
const THIN_BLOCK_INSET = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS
const LILY_PAD_HEIGHT_DIVISOR = 64
const LILY_PAD_HEIGHT = UNIT_SIZE / LILY_PAD_HEIGHT_DIVISOR
const DEFAULT_RAIL_SHAPE: RailShape = 'north_south'
const SLAB_HEIGHT_DIVISOR = 2
const SLAB_HEIGHT = UNIT_SIZE / SLAB_HEIGHT_DIVISOR
const PRESSURE_PLATE_HEIGHT = UNIT_SIZE / BLOCK_MODEL_SUBDIVISIONS

const UNKNOWN_OPACITY_CODE = 0
const OPAQUE_OPACITY_CODE = 1
const NON_OPAQUE_CODE = 2

export type SpecialBlockLookup = {
  readonly kindCodes: Readonly<Uint8Array>
  readonly opacityCodes: Readonly<Uint8Array>
  readonly railKinds: readonly (RailRenderKind | undefined)[]
}

export type SpecialBlockLookupFailure = BlockRegistryResolutionFailure | RailRenderKindFailure

export type SpecialMeshFailure =
  | SpecialBlockLookupFailure
  | RailShapeFailure
  | { readonly _tag: 'MissingSpecialBlockLookupEntry'; readonly blockId: BlockId }

const lightPropertiesOf = (light?: QuadLight): { light?: QuadLight } => {
  if (light) {
    return { light }
  }
  return {}
}

const specialKindCodeOf = (
  renderKind: RenderKind,
  collisionShape: CollisionShape,
): number => {
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
    kindCodes[blockId] = specialKindCodeOf(renderKind.success, collisionShape.success)
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

type BoxRenderKind = Extract<SpecialRenderKind, 'cactus' | 'pressurePlate' | 'slab'>

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

const BOX_BOUNDS_FACTORIES: Readonly<Record<BoxRenderKind, BoxBoundsFactory>> = {
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
  slab: (lx, y, lz) => ({
    maxX: lx + UNIT_SIZE,
    maxY: y + SLAB_HEIGHT,
    maxZ: lz + UNIT_SIZE,
    minX: lx,
    minY: y,
    minZ: lz,
  }),
}

const boxBoundsFor = (kind: BoxRenderKind, lx: number, y: number, lz: number): BoxBounds =>
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
): SpecialBlockQuad => ({
  blockId,
  kind,
  vertices: boxVertices(face, bounds),
  ...face,
  ...lightPropertiesOf(light),
})

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

const railShapeProperties = (railShape: Option.Option<RailShape>): { railShape?: RailShape } => {
  if (Option.isNone(railShape)) {
    return {}
  }
  return { railShape: railShape.value }
}

const railQuad = (
  railKind: RailRenderKind,
  blockId: BlockId,
  geometryShape: RailShape,
  stateShape: Option.Option<RailShape>,
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
    ...railShapeProperties(stateShape),
  }
}

const railQuads = (
  lookup: SpecialBlockLookup,
  blockId: BlockId,
  lx: number,
  y: number,
  lz: number,
  railShape: Option.Option<RailShape>,
  topLight: QuadLight | undefined,
  bottomLight: QuadLight | undefined,
): Result.Result<readonly [RailSpecialBlockQuad, RailSpecialBlockQuad], RailRenderKindFailure> => {
  const railKind = railKindOf(lookup, blockId)
  if (Result.isFailure(railKind)) {
    return Result.fail(railKind.failure)
  }
  const geometryShape = Option.isSome(railShape) ? railShape.value : DEFAULT_RAIL_SHAPE
  const position: BlockPosition = [lx, y, lz]
  const top = railQuad(railKind.success, blockId, geometryShape, railShape, position, TOP_FACE, topLight)
  const bottom = railQuad(railKind.success, blockId, geometryShape, railShape, position, faceOf('yNeg'), bottomLight)
  return Result.succeed([top, bottom])
}

const meshBoxCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: BoxRenderKind,
  position: BlockPosition,
  config: MeshConfig,
): Result.Result<void, SpecialMeshFailure> => {
  const [lx, y, lz] = position
  const bounds = boxBoundsFor(kind, lx, y, lz)
  for (const face of FACES) {
    const open = isOpenToSpecial(lookup, chunk, neighbours, kind, position, face, config)
    if (typeof open !== 'boolean') {
      return Result.fail(open)
    }
    if (open) {
      result.push(
        makeBoxQuad(
          blockId,
          kind,
          face,
          bounds,
          quadLightAt(chunk, neighbours, face.direction, lx, y, lz),
        ),
      )
    }
  }
  return Result.void
}

const meshPlanarCell = (
  result: Array<SpecialBlockQuad>,
  lookup: SpecialBlockLookup,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: Extract<SpecialRenderKind, 'lilyPad' | 'rail'>,
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
  if (kind === 'lilyPad') {
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
  const railShapeResult = railShapeAt(
    Option.fromNullishOr(chunk.railShapes),
    blockIndex(lx, y, lz, chunk.height),
  )
  if (Result.isFailure(railShapeResult)) {
    return Result.fail(railShapeResult.failure)
  }
  const railShape = railShapeResult.success
  const quads = railQuads(
    lookup,
    blockId,
    lx,
    y,
    lz,
    railShape,
    quadLightAt(chunk, neighbours, 'yPos', lx, y, lz),
    quadLightAt(chunk, neighbours, 'yNeg', lx, y, lz),
  )
  if (Result.isFailure(quads)) {
    return Result.fail(quads.failure)
  }
  result.push(...quads.success)
  return Result.void
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
  if (kind === 'cactus' || kind === 'slab' || kind === 'pressurePlate') {
    return meshBoxCell(result, lookup, chunk, neighbours, blockId, kind, position, config)
  }
  return meshPlanarCell(result, lookup, chunk, neighbours, blockId, kind, position, config)
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
