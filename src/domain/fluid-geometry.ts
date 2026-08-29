import {
  CELL_SPAN,
  type FluidContext,
  type FluidQuad,
  LOOP_STEP,
  NO_FLUID,
  cornerHeight,
  flowAt,
  heightAcross,
  heightIn,
  hidesFluidFace,
  isFluidBlock,
} from './fluid-state.js'
import {
  type ChunkNeighbours,
  type ChunkView,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { BLOCK_ID_MAX } from './opacity.js'

export type FluidBounds = {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

const AXIS_POSITIVE_STEP = 1
const AXIS_NEGATIVE_STEP = -1
const AXIS_NO_STEP = 0
const CELL_ORIGIN = 0
const CELL_END = CELL_ORIGIN + CELL_SPAN
const NO_AO = CELL_ORIGIN
const EMPTY_FLUID_LOOKUP = CELL_ORIGIN
const SIDE_STEP: Readonly<Record<'xPos' | 'xNeg' | 'zPos' | 'zNeg', readonly [dx: number, dz: number]>> = {
  xNeg: [AXIS_NEGATIVE_STEP, AXIS_NO_STEP],
  xPos: [AXIS_POSITIVE_STEP, AXIS_NO_STEP],
  zNeg: [AXIS_NO_STEP, AXIS_NEGATIVE_STEP],
  zPos: [AXIS_NO_STEP, AXIS_POSITIVE_STEP],
}

const bottomOf = (y: number, neighbourHeight: number): number => {
  if (neighbourHeight === NO_FLUID) {
    return y
  }
  return y + neighbourHeight
}

const sideEnds = (direction: 'xPos' | 'xNeg' | 'zPos' | 'zNeg', lx: number, lz: number): readonly [number, number, number, number] => {
  if (direction === 'xPos') {
    return [lx + CELL_SPAN, lz, lx + CELL_SPAN, lz + CELL_SPAN]
  }
  if (direction === 'xNeg') {
    return [lx, lz + CELL_SPAN, lx, lz]
  }
  if (direction === 'zPos') {
    return [lx + CELL_SPAN, lz + CELL_SPAN, lx, lz + CELL_SPAN]
  }
  return [lx, lz, lx + CELL_SPAN, lz]
}

const pushSide = (
  quads: Array<FluidQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
  here: number,
  direction: 'xPos' | 'xNeg' | 'zPos' | 'zNeg',
  topNear: number,
  topFar: number,
): void => {
  const [dx, dz] = SIDE_STEP[direction]
  if (hidesFluidFace(context, getBlockAcrossBoundary(chunk, neighbours, lx + dx, y, lz + dz))) {
    return
  }
  const neighbourHeight = heightAcross(chunk, neighbours, context, lx + dx, y, lz + dz, blockId)
  if (neighbourHeight !== NO_FLUID && neighbourHeight >= here) {
    return
  }
  const bottom = bottomOf(y, neighbourHeight)
  const [nearX, nearZ, farX, farZ] = sideEnds(direction, lx, lz)
  quads.push({
    ao: NO_AO,
    blockId,
    direction,
    vertices: [
      [nearX, bottom, nearZ],
      [nearX, topNear, nearZ],
      [farX, topFar, farZ],
      [farX, bottom, farZ],
    ],
  })
}

const pushTopFace = (
  quads: Array<FluidQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
  here: number,
  corners: readonly [number, number, number, number],
): void => {
  const aboveId = getBlockAcrossBoundary(chunk, neighbours, lx, y + CELL_SPAN, lz)
  if (hidesFluidFace(context, aboveId) || isFluidBlock(context.fluids, aboveId)) {
    return
  }
  const [y00, y01, y11, y10] = corners
  quads.push({
    ao: NO_AO,
    blockId,
    direction: 'yPos',
    flow: flowAt(chunk, neighbours, context, lx, y, lz, blockId, here),
    vertices: [
      [lx, y00, lz],
      [lx, y01, lz + CELL_SPAN],
      [lx + CELL_SPAN, y11, lz + CELL_SPAN],
      [lx + CELL_SPAN, y10, lz],
    ],
  })
}

const pushBottomFace = (
  quads: Array<FluidQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
): void => {
  const belowId = getBlockAcrossBoundary(chunk, neighbours, lx, y - CELL_SPAN, lz)
  if (hidesFluidFace(context, belowId) || isFluidBlock(context.fluids, belowId)) {
    return
  }
  quads.push({
    ao: NO_AO,
    blockId,
    direction: 'yNeg',
    vertices: [
      [lx, y, lz],
      [lx + CELL_SPAN, y, lz],
      [lx + CELL_SPAN, y, lz + CELL_SPAN],
      [lx, y, lz + CELL_SPAN],
    ],
  })
}

const topPatchCorners = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
): readonly [number, number, number, number] => {
  const y00 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, CELL_ORIGIN, CELL_ORIGIN, blockId)
  const y01 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, CELL_ORIGIN, CELL_END, blockId)
  const y11 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, CELL_END, CELL_END, blockId)
  const y10 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, CELL_END, CELL_ORIGIN, blockId)
  return [y00, y01, y11, y10]
}

const meshFluidCell = (
  quads: Array<FluidQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
): void => {
  const here = heightIn(chunk, context, lx, y, lz, blockId)
  const corners = topPatchCorners(chunk, neighbours, context, lx, y, lz, blockId)
  const [y00, y01, y11, y10] = corners

  pushTopFace(quads, chunk, neighbours, context, lx, y, lz, blockId, here, corners)
  pushBottomFace(quads, chunk, neighbours, context, lx, y, lz, blockId)
  pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'xPos', y10, y11)
  pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'xNeg', y01, y00)
  pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'zPos', y11, y01)
  pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'zNeg', y00, y10)
}

const anyFluidConfigured = (fluids: Uint8Array): boolean => {
  for (let blockId = 0; blockId <= BLOCK_ID_MAX; blockId += LOOP_STEP) {
    if (fluids[blockId]! !== EMPTY_FLUID_LOOKUP) {
      return true
    }
  }
  return false
}

export const meshFluidCellsInBounds = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  fluids: Uint8Array,
  layers: Uint8Array,
  plants: Uint8Array,
  yLimit: number,
  bounds: FluidBounds,
): ReadonlyArray<FluidQuad> => {
  const quads: Array<FluidQuad> = []
  const context: FluidContext = { fluids, layers, plants }
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = [bounds.min, bounds.max]

  for (let lx = minX; lx < maxX; lx += LOOP_STEP) {
    for (let y = minY; y < Math.min(yLimit, maxY); y += LOOP_STEP) {
      for (let lz = minZ; lz < maxZ; lz += LOOP_STEP) {
        const blockId = getBlock(chunk, lx, y, lz)
        if (isFluidBlock(fluids, blockId)) {
          meshFluidCell(quads, chunk, neighbours, context, lx, y, lz, blockId)
        }
      }
    }
  }
  return quads
}

export const hasFluidGeometry = (fluids: Uint8Array): boolean => anyFluidConfigured(fluids)
