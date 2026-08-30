import { AIR, type BlockId, MAX_BLOCK_ID } from './block-data.js'
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
  type RailSpecialBlockQuad,
  type SpecialBlockQuad,
  type SpecialMeshRegion,
  type SpecialRenderKind,
  type SpecialVertex,
  railRenderKindOf,
} from './special-types.js'
import { type RailShape, railShapeAt } from './rail-types.js'
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

const SPECIAL_BLOCK_LOOKUP = new Uint8Array(MAX_BLOCK_ID + UNIT_SIZE)

const lightPropertiesOf = (light?: QuadLight): { light?: QuadLight } => {
  if (light) {
    return { light }
  }
  return {}
}

const specialKindCodeOf = (blockId: number): number => {
  const renderKind = propertyOfBlockId(blockId, 'renderKind')
  switch (renderKind) {
    case 'cactus':
      return CACTUS_KIND_CODE
    case 'lilyPad':
      return LILY_PAD_KIND_CODE
    case 'rail':
      return RAIL_KIND_CODE
    default:
      switch (propertyOfBlockId(blockId, 'collisionShape')) {
        case 'pressurePlate':
          return PRESSURE_PLATE_KIND_CODE
        case 'slab':
          return SLAB_KIND_CODE
        default:
          return SPECIAL_KIND_NONE
      }
  }
}

for (const blockId of BLOCK_IDS) {
  SPECIAL_BLOCK_LOOKUP[blockId] = specialKindCodeOf(blockId)
}

type BoxRenderKind = Extract<SpecialRenderKind, 'cactus' | 'pressurePlate' | 'slab'>

const specialKindOf = (blockId: number): SpecialRenderKind | null => {
  switch (SPECIAL_BLOCK_LOOKUP[blockId]) {
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

export const isSpecialBlock = (blockId: number): boolean =>
  (SPECIAL_BLOCK_LOOKUP[blockId] ?? SPECIAL_KIND_NONE) !== SPECIAL_KIND_NONE

type BoxBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
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

const railKindOf = (blockId: number): RailRenderKind => railRenderKindOf(propertyOfBlockId(blockId, 'railKind'))

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
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  kind: SpecialRenderKind,
  lx: number,
  y: number,
  lz: number,
  face: Face,
): boolean => {
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
  if (propertyOfBlockId(neighbourId, 'opacity') === 'opaque') {
    return false
  }
  return specialKindOf(neighbourId) !== kind
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

const railShapeProperties = (railShape: RailShape | undefined): { railShape?: RailShape } => {
  if (!railShape) {
    return {}
  }
  return { railShape }
}

const railQuad = (
  blockId: BlockId,
  geometryShape: RailShape,
  stateShape: RailShape | undefined,
  lx: number,
  y: number,
  lz: number,
  face: FaceFor<RailFaceDirection>,
  light: QuadLight | undefined,
): RailSpecialBlockQuad => ({
    blockId,
    kind: 'rail',
    railKind: railKindOf(blockId),
    vertices: railVerticesOf(geometryShape, lx, y, lz, face.direction),
    ...face,
    ...lightPropertiesOf(light),
    ...railShapeProperties(stateShape),
  })

const railQuads = (
  blockId: BlockId,
  lx: number,
  y: number,
  lz: number,
  railShape: RailShape | undefined,
  topLight: QuadLight | undefined,
  bottomLight: QuadLight | undefined,
): readonly [RailSpecialBlockQuad, RailSpecialBlockQuad] => {
  const geometryShape = railShape ?? DEFAULT_RAIL_SHAPE
  return [
    railQuad(blockId, geometryShape, railShape, lx, y, lz, TOP_FACE, topLight),
    railQuad(blockId, geometryShape, railShape, lx, y, lz, faceOf('yNeg'), bottomLight),
  ]
}

const meshBoxCell = (
  result: Array<SpecialBlockQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: BoxRenderKind,
  lx: number,
  y: number,
  lz: number,
): void => {
  const bounds = boxBoundsFor(kind, lx, y, lz)
  for (const face of FACES) {
    if (isOpenToSpecial(chunk, neighbours, kind, lx, y, lz, face)) {
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
}

const meshPlanarCell = (
  result: Array<SpecialBlockQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: Extract<SpecialRenderKind, 'lilyPad' | 'rail'>,
  lx: number,
  y: number,
  lz: number,
): void => {
  if (!isOpenToSpecial(chunk, neighbours, kind, lx, y, lz, TOP_FACE)) {
    return
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
    return
  }
  result.push(
    ...railQuads(
      blockId,
      lx,
      y,
      lz,
      railShapeAt(chunk.railShapes, blockIndex(lx, y, lz, chunk.height)),
      quadLightAt(chunk, neighbours, 'yPos', lx, y, lz),
      quadLightAt(chunk, neighbours, 'yNeg', lx, y, lz),
    ),
  )
}

const meshSpecialCell = (
  result: Array<SpecialBlockQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  blockId: BlockId,
  kind: SpecialRenderKind,
  lx: number,
  y: number,
  lz: number,
): void => {
  if (kind === 'cactus' || kind === 'slab' || kind === 'pressurePlate') {
    meshBoxCell(result, chunk, neighbours, blockId, kind, lx, y, lz)
    return
  }
  meshPlanarCell(result, chunk, neighbours, blockId, kind, lx, y, lz)
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
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  yLimit: number,
  region?: SpecialMeshRegion,
): ReadonlyArray<SpecialBlockQuad> => {
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
        const blockId = (chunk.blocks[columnOffset + y] ?? AIR) as BlockId
        const kind = specialKindOf(blockId)
        if (kind !== null) {
          meshSpecialCell(result, chunk, neighbours, blockId, kind, lx, y, lz)
        }
      }
    }
  }
  return result
}
