import { BLOCK_ID_MAX, type CollisionShape, type RenderKind } from '@nerima-games/mc-kernel'
import { CHUNK_SIZE, type ChunkNeighbours, type ChunkView, getBlock, getBlockAcrossBoundary } from './chunk-view.js'
import { FACES, type Face, type FaceDirection, type FaceRole } from './faces.js'
import type { MeshConfig } from './opacity.js'

const SPECIAL_NONE = 0
const SPECIAL_CACTUS = 1
const SPECIAL_RAIL = 2
const SPECIAL_LILY_PAD = 3
const SPECIAL_SLAB = 4
const SPECIAL_PRESSURE_PLATE = 5
const AXIS_ORIGIN = 0
const CELL_SIZE = 1
const HALF_DIVISOR = 2
const HALF_CELL = CELL_SIZE / HALF_DIVISOR
const LOOP_STEP = 1
const GRID_SUBDIVISIONS = 16
const LILY_PAD_DIVISOR = 64
const TABLE_SIZE_OFFSET = 1
const SPECIAL_INSET = CELL_SIZE / GRID_SUBDIVISIONS
const RAIL_STRIP_HALF_WIDTH = SPECIAL_INSET
const SLAB_HEIGHT = CELL_SIZE / HALF_DIVISOR
const PRESSURE_PLATE_HEIGHT = CELL_SIZE / GRID_SUBDIVISIONS
const LILY_PAD_HEIGHT = CELL_SIZE / LILY_PAD_DIVISOR

export type SpecialRenderKind = Exclude<RenderKind, 'cube' | 'cross' | 'fluid'> | 'slab' | 'pressurePlate'

type SpecialVertex = readonly [x: number, y: number, z: number]

export type SpecialQuad = {
  readonly ao: number
  readonly blockId: number
  readonly direction: FaceDirection
  readonly normal: readonly [nx: number, ny: number, nz: number]
  readonly renderKind: SpecialRenderKind
  readonly role: FaceRole
  readonly vertices: readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex]
}

export type SpecialFaceVisibility = (blockId: number, neighbourId: number) => boolean

export type SpecialBounds = {
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly minX: number
  readonly minY: number
  readonly minZ: number
}

export type SpecialMeshOptions = {
  readonly bounds?: SpecialBounds
  readonly chunk: ChunkView
  readonly isFaceVisible: SpecialFaceVisibility
  readonly lookup: Uint8Array
  readonly neighbours: ChunkNeighbours
  readonly yLimit: number
}

type SpecialCell = {
  readonly blockId: number
  readonly x: number
  readonly y: number
  readonly z: number
}

type RailGeometry = {
  readonly blockId: number
  readonly x0: number
  readonly x1: number
  readonly y: number
  readonly z0: number
  readonly z1: number
}

type SpecialMeshContext = {
  readonly chunk: ChunkView
  readonly isFaceVisible: SpecialFaceVisibility
  readonly lookup: Uint8Array
  readonly neighbours: ChunkNeighbours
  readonly quads: Array<SpecialQuad>
}

type SpecialColumn = {
  readonly bounds: SpecialBounds
  readonly context: SpecialMeshContext
  readonly x: number
  readonly z: number
}

const specialCodeOf = (renderKind: RenderKind, collisionShape?: CollisionShape): number => {
  switch (renderKind) {
    case 'cactus':
      return SPECIAL_CACTUS
    case 'rail':
      return SPECIAL_RAIL
    case 'lilyPad':
      return SPECIAL_LILY_PAD
    default:
      if (collisionShape === 'slab') {
        return SPECIAL_SLAB
      }
      if (collisionShape === 'pressurePlate') {
        return SPECIAL_PRESSURE_PLATE
      }
      return SPECIAL_NONE
  }
}

export const buildSpecialLookup = (config: MeshConfig): Uint8Array => {
  const lookup = new Uint8Array(BLOCK_ID_MAX + TABLE_SIZE_OFFSET)
  for (const [blockId, renderKind] of config.renderKindByBlockId ?? []) {
    lookup[blockId] = specialCodeOf(renderKind)
  }
  for (const [blockId, collisionShape] of config.collisionShapeByBlockId ?? []) {
    if (lookup[blockId] === SPECIAL_NONE) {
      lookup[blockId] = specialCodeOf('cube', collisionShape)
    }
  }
  return lookup
}

export const specialKindOf = (lookup: Uint8Array, blockId: number): SpecialRenderKind | null => {
  switch (lookup[blockId] ?? SPECIAL_NONE) {
    case SPECIAL_CACTUS:
      return 'cactus'
    case SPECIAL_RAIL:
      return 'rail'
    case SPECIAL_LILY_PAD:
      return 'lilyPad'
    case SPECIAL_SLAB:
      return 'slab'
    case SPECIAL_PRESSURE_PLATE:
      return 'pressurePlate'
    default:
      return null
  }
}

export const isSpecialBlock = (lookup: Uint8Array, blockId: number): boolean =>
  (lookup[blockId] ?? SPECIAL_NONE) !== SPECIAL_NONE

const hasSpecialGeometry = (lookup: Uint8Array): boolean => {
  for (let blockId = 0; blockId <= BLOCK_ID_MAX; blockId += LOOP_STEP) {
    if (lookup[blockId] !== SPECIAL_NONE) {
      return true
    }
  }
  return false
}

type PrimitiveBounds = {
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly minX: number
  readonly minY: number
  readonly minZ: number
}

const faceVertices = (
  face: Face,
  cell: SpecialCell,
  bounds: PrimitiveBounds,
): readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex] => {
  const x0 = cell.x + bounds.minX
  const x1 = cell.x + bounds.maxX
  const y0 = cell.y + bounds.minY
  const y1 = cell.y + bounds.maxY
  const z0 = cell.z + bounds.minZ
  const z1 = cell.z + bounds.maxZ

  switch (face.direction) {
    case 'xPos':
      return [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]
    case 'xNeg':
      return [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]
    case 'yPos':
      return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]
    case 'yNeg':
      return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]
    case 'zPos':
      return [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]
    default:
      return [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]
  }
}

const CACTUS_BOUNDS: PrimitiveBounds = {
  maxX: CELL_SIZE - SPECIAL_INSET,
  maxY: CELL_SIZE - SPECIAL_INSET,
  maxZ: CELL_SIZE - SPECIAL_INSET,
  minX: SPECIAL_INSET,
  minY: SPECIAL_INSET,
  minZ: SPECIAL_INSET,
}

const specialQuad = (
  blockId: number,
  renderKind: SpecialRenderKind,
  face: Face,
  vertices: readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex],
): SpecialQuad => ({
  ao: AXIS_ORIGIN,
  blockId,
  direction: face.direction,
  normal: [face.nx, face.ny, face.nz],
  renderKind,
  role: face.role,
  vertices,
})

const cactusQuads = (cell: SpecialCell, context: SpecialMeshContext): ReadonlyArray<SpecialQuad> => {
  const quads: Array<SpecialQuad> = []
  for (const face of FACES) {
    const neighbourId = getBlockAcrossBoundary(
      context.chunk,
      context.neighbours,
      cell.x + face.nx,
      cell.y + face.ny,
      cell.z + face.nz,
    )
    if (context.isFaceVisible(cell.blockId, neighbourId)) {
      quads.push(specialQuad(cell.blockId, 'cactus', face, faceVertices(face, cell, CACTUS_BOUNDS)))
    }
  }
  return quads
}

type BoxRenderKind = 'slab' | 'pressurePlate'

const boxBounds = (renderKind: BoxRenderKind): PrimitiveBounds => {
  if (renderKind === 'slab') {
    return {
      maxX: CELL_SIZE,
      maxY: SLAB_HEIGHT,
      maxZ: CELL_SIZE,
      minX: AXIS_ORIGIN,
      minY: AXIS_ORIGIN,
      minZ: AXIS_ORIGIN,
    }
  }
  return {
    maxX: CELL_SIZE - SPECIAL_INSET,
    maxY: PRESSURE_PLATE_HEIGHT,
    maxZ: CELL_SIZE - SPECIAL_INSET,
    minX: SPECIAL_INSET,
    minY: AXIS_ORIGIN,
    minZ: SPECIAL_INSET,
  }
}

const boxQuads = (
  cell: SpecialCell,
  renderKind: BoxRenderKind,
  context: SpecialMeshContext,
): ReadonlyArray<SpecialQuad> => {
  const quads: Array<SpecialQuad> = []
  const bounds = boxBounds(renderKind)
  for (const face of FACES) {
    const neighbourId = getBlockAcrossBoundary(
      context.chunk,
      context.neighbours,
      cell.x + face.nx,
      cell.y + face.ny,
      cell.z + face.nz,
    )
    if (context.isFaceVisible(cell.blockId, neighbourId)) {
      quads.push(specialQuad(cell.blockId, renderKind, face, faceVertices(face, cell, bounds)))
    }
  }
  return quads
}

const lilyPadQuad = (cell: SpecialCell): SpecialQuad => {
  const face: Face = { direction: 'yPos', nx: AXIS_ORIGIN, ny: CELL_SIZE, nz: AXIS_ORIGIN, role: 'top' }
  const yTop = cell.y + LILY_PAD_HEIGHT
  const vertices: readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex] = [
    [cell.x + SPECIAL_INSET, yTop, cell.z + CELL_SIZE - SPECIAL_INSET],
    [cell.x + CELL_SIZE - SPECIAL_INSET, yTop, cell.z + CELL_SIZE - SPECIAL_INSET],
    [cell.x + CELL_SIZE - SPECIAL_INSET, yTop, cell.z + SPECIAL_INSET],
    [cell.x + SPECIAL_INSET, yTop, cell.z + SPECIAL_INSET],
  ]
  return specialQuad(cell.blockId, 'lilyPad', face, vertices)
}

const railQuad = ({ blockId, x0, x1, y, z0, z1 }: RailGeometry): SpecialQuad => {
  const face: Face = { direction: 'yPos', nx: AXIS_ORIGIN, ny: CELL_SIZE, nz: AXIS_ORIGIN, role: 'top' }
  const yTop = y + SPECIAL_INSET
  const vertices: readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex] = [
    [x0, yTop, z1],
    [x1, yTop, z1],
    [x1, yTop, z0],
    [x0, yTop, z0],
  ]
  return specialQuad(blockId, 'rail', face, vertices)
}

const railQuads = (cell: SpecialCell, context: SpecialMeshContext): ReadonlyArray<SpecialQuad> => {
  const neighbourId = getBlockAcrossBoundary(
    context.chunk,
    context.neighbours,
    cell.x,
    cell.y + CELL_SIZE,
    cell.z,
  )
  if (!context.isFaceVisible(cell.blockId, neighbourId)) {
    return []
  }
  return [
    railQuad({
      blockId: cell.blockId,
      x0: cell.x,
      x1: cell.x + CELL_SIZE,
      y: cell.y,
      z0: cell.z + HALF_CELL - RAIL_STRIP_HALF_WIDTH,
      z1: cell.z + HALF_CELL + RAIL_STRIP_HALF_WIDTH,
    }),
    railQuad({
      blockId: cell.blockId,
      x0: cell.x + HALF_CELL - RAIL_STRIP_HALF_WIDTH,
      x1: cell.x + HALF_CELL + RAIL_STRIP_HALF_WIDTH,
      y: cell.y,
      z0: cell.z,
      z1: cell.z + CELL_SIZE,
    }),
  ]
}

const lilyPadQuads = (cell: SpecialCell, context: SpecialMeshContext): ReadonlyArray<SpecialQuad> => {
  const neighbourId = getBlockAcrossBoundary(
    context.chunk,
    context.neighbours,
    cell.x,
    cell.y + CELL_SIZE,
    cell.z,
  )
  if (!context.isFaceVisible(cell.blockId, neighbourId)) {
    return []
  }
  return [lilyPadQuad(cell)]
}

const specialQuadsAt = (
  cell: SpecialCell,
  renderKind: SpecialRenderKind,
  context: SpecialMeshContext,
): ReadonlyArray<SpecialQuad> => {
  if (renderKind === 'slab') {
    return boxQuads(cell, 'slab', context)
  }
  if (renderKind === 'pressurePlate') {
    return boxQuads(cell, 'pressurePlate', context)
  }
  if (renderKind === 'cactus') {
    return cactusQuads(cell, context)
  }
  if (renderKind === 'rail') {
    return railQuads(cell, context)
  }
  return lilyPadQuads(cell, context)
}

const defaultBounds = (yLimit: number): SpecialBounds => ({
  maxX: CHUNK_SIZE,
  maxY: yLimit,
  maxZ: CHUNK_SIZE,
  minX: AXIS_ORIGIN,
  minY: AXIS_ORIGIN,
  minZ: AXIS_ORIGIN,
})

const meshSpecialColumn = ({ bounds, context, x, z }: SpecialColumn): void => {
  for (let y = bounds.minY; y < bounds.maxY; y += LOOP_STEP) {
    const blockId = getBlock(context.chunk, x, y, z)
    const renderKind = specialKindOf(context.lookup, blockId)
    if (renderKind !== null) {
      context.quads.push(...specialQuadsAt({ blockId, x, y, z }, renderKind, context))
    }
  }
}

/** Emit geometry for kernel render kinds that are neither cubes nor crosses. */
export const meshSpecialBlocks = (options: SpecialMeshOptions): ReadonlyArray<SpecialQuad> => {
  if (!hasSpecialGeometry(options.lookup)) {
    return []
  }
  const bounds = options.bounds ?? defaultBounds(options.yLimit)
  const quads: Array<SpecialQuad> = []
  const context: SpecialMeshContext = {
    chunk: options.chunk,
    isFaceVisible: options.isFaceVisible,
    lookup: options.lookup,
    neighbours: options.neighbours,
    quads,
  }
  for (let x = bounds.minX; x < bounds.maxX; x += LOOP_STEP) {
    for (let z = bounds.minZ; z < bounds.maxZ; z += LOOP_STEP) {
      meshSpecialColumn({ bounds, context, x, z })
    }
  }
  return quads
}
