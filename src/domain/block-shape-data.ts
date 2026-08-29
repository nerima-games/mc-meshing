import type { BlockShapeKind } from './geometry-types.js'

export type BlockShapeBounds = {
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly minX: number
  readonly minY: number
  readonly minZ: number
}

const CELL_SIZE = 1
const HALF_CELL = CELL_SIZE / 2
const GRID_SUBDIVISIONS = 16
const LILY_PAD_DIVISOR = 64
const INSET = CELL_SIZE / GRID_SUBDIVISIONS

export const BLOCK_SHAPE_BOUNDS: Readonly<Record<BlockShapeKind, BlockShapeBounds>> = {
  cactus: {
    maxX: CELL_SIZE - INSET,
    maxY: CELL_SIZE,
    maxZ: CELL_SIZE - INSET,
    minX: INSET,
    minY: 0,
    minZ: INSET,
  },
  lilyPad: {
    maxX: CELL_SIZE - INSET,
    maxY: CELL_SIZE / LILY_PAD_DIVISOR,
    maxZ: CELL_SIZE - INSET,
    minX: INSET,
    minY: 0,
    minZ: INSET,
  },
  pressurePlate: {
    maxX: CELL_SIZE - INSET,
    maxY: INSET,
    maxZ: CELL_SIZE - INSET,
    minX: INSET,
    minY: 0,
    minZ: INSET,
  },
  rail: {
    maxX: CELL_SIZE,
    maxY: INSET,
    maxZ: CELL_SIZE,
    minX: 0,
    minY: 0,
    minZ: 0,
  },
  slab: {
    maxX: CELL_SIZE,
    maxY: HALF_CELL,
    maxZ: CELL_SIZE,
    minX: 0,
    minY: 0,
    minZ: 0,
  },
}

export const RAIL_STRIP_BOUNDS: ReadonlyArray<BlockShapeBounds> = [
  {
    maxX: CELL_SIZE,
    maxY: INSET,
    maxZ: HALF_CELL + INSET,
    minX: 0,
    minY: 0,
    minZ: HALF_CELL - INSET,
  },
  {
    maxX: HALF_CELL + INSET,
    maxY: INSET,
    maxZ: CELL_SIZE,
    minX: HALF_CELL - INSET,
    minY: 0,
    minZ: 0,
  },
]
