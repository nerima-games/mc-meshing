import {
  AIR,
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  type FluidView,
  blockIndex,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { BLOCK_ID_MAX, type MeshConfig, occludes } from './opacity.js'
import type { FluidFlow } from './geometry-types.js'
export type { FluidQuad } from './geometry-types.js'
import { isCrossPlant } from './plant-mesh.js'

const INDEX_TO_COUNT_OFFSET = 1
const FLUID_BYTE_UNSET = 0
const FULL_HEIGHT = 1
const ZERO_INDEX = 0
const CORNER_WINDOW_START_OFFSET = 1
const AXIS_POSITIVE_STEP = 1
const AXIS_NEGATIVE_STEP = -1
const AXIS_NO_STEP = 0
const CELL_BELOW_STEP = 1
const ZERO_FLOW_LENGTH = AXIS_NO_STEP
const SOURCE_SURFACE_NUMERATOR = 14
const SOURCE_SURFACE_DENOMINATOR = 16

export const CELL_SPAN = 1
export const LOOP_STEP = 1
export const NO_FLUID = -1

/** Height used for a visible source surface. */
export const SOURCE_SURFACE_HEIGHT = SOURCE_SURFACE_NUMERATOR / SOURCE_SURFACE_DENOMINATOR

export type FluidContext = {
  readonly fluids: Uint8Array
  readonly layers: Uint8Array
  readonly plants: Uint8Array
}

export const buildFluidLookup = (config: MeshConfig): Uint8Array => {
  const lookup = new Uint8Array(BLOCK_ID_MAX + INDEX_TO_COUNT_OFFSET)
  for (const [blockId, maxLevel] of config.fluidMaxLevels ?? []) {
    lookup[blockId] = maxLevel + INDEX_TO_COUNT_OFFSET
  }
  return lookup
}

export const isFluidBlock = (lookup: Uint8Array, blockId: number): boolean => lookup[blockId]! !== FLUID_BYTE_UNSET

const maxLevelOf = (lookup: Uint8Array, blockId: number): number => lookup[blockId]! - INDEX_TO_COUNT_OFFSET

const heightForLevel = (level: number, maxLevel: number, source: boolean): number => {
  if (source) {
    return SOURCE_SURFACE_HEIGHT
  }
  const steps = maxLevel + INDEX_TO_COUNT_OFFSET
  const filled = FULL_HEIGHT - level / steps
  const floor = FULL_HEIGHT / steps
  if (filled < floor) {
    return floor
  }
  return filled
}

const levelIn = (fluid: FluidView | undefined, index: number): number => fluid?.levels[index] ?? FLUID_BYTE_UNSET

const sourceIn = (fluid: FluidView | undefined, index: number): boolean =>
  (fluid?.sources[index] ?? FLUID_BYTE_UNSET) !== FLUID_BYTE_UNSET

const fallingIn = (fluid: FluidView | undefined, index: number): boolean =>
  (fluid?.falling?.[index] ?? FLUID_BYTE_UNSET) !== FLUID_BYTE_UNSET

export const heightIn = (
  view: ChunkView,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  if (getBlock(view, lx, y, lz) !== wantId) {
    return NO_FLUID
  }
  const index = blockIndex(lx, y, lz, view.height)
  return heightForLevel(levelIn(view.fluid, index), maxLevelOf(context.fluids, wantId), sourceIn(view.fluid, index))
}

const CHUNK_MAX_INDEX = CHUNK_SIZE - INDEX_TO_COUNT_OFFSET

const heightInNeighbour = (
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
  neighbour?: ChunkView,
): number => {
  if (!neighbour) {
    return NO_FLUID
  }
  return heightIn(neighbour, context, lx, y, lz, wantId)
}

const heightAcrossCorner = (
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  if (lx < ZERO_INDEX && lz < ZERO_INDEX) {
    return heightInNeighbour(context, CHUNK_MAX_INDEX, y, CHUNK_MAX_INDEX, wantId, neighbours.xNegZNeg)
  }
  if (lx < ZERO_INDEX) {
    return heightInNeighbour(context, CHUNK_MAX_INDEX, y, ZERO_INDEX, wantId, neighbours.xNegZPos)
  }
  if (lz < ZERO_INDEX) {
    return heightInNeighbour(context, ZERO_INDEX, y, CHUNK_MAX_INDEX, wantId, neighbours.xPosZNeg)
  }
  return heightInNeighbour(context, ZERO_INDEX, y, ZERO_INDEX, wantId, neighbours.xPosZPos)
}

const heightAcrossEdge = (
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  if (lx < ZERO_INDEX) {
    return heightInNeighbour(context, CHUNK_MAX_INDEX, y, lz, wantId, neighbours.xNeg)
  }
  if (lx >= CHUNK_SIZE) {
    return heightInNeighbour(context, ZERO_INDEX, y, lz, wantId, neighbours.xPos)
  }
  if (lz < ZERO_INDEX) {
    return heightInNeighbour(context, lx, y, CHUNK_MAX_INDEX, wantId, neighbours.zNeg)
  }
  return heightInNeighbour(context, lx, y, ZERO_INDEX, wantId, neighbours.zPos)
}

export const heightAcross = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  const xOut = lx < ZERO_INDEX || lx >= CHUNK_SIZE
  const zOut = lz < ZERO_INDEX || lz >= CHUNK_SIZE
  if (xOut && zOut) {
    return heightAcrossCorner(neighbours, context, lx, y, lz, wantId)
  }
  if (xOut || zOut) {
    return heightAcrossEdge(neighbours, context, lx, y, lz, wantId)
  }
  return heightIn(chunk, context, lx, y, lz, wantId)
}

const FLOW_OFFSETS: ReadonlyArray<readonly [dx: number, dz: number]> = [
  [AXIS_POSITIVE_STEP, AXIS_NO_STEP],
  [AXIS_NEGATIVE_STEP, AXIS_NO_STEP],
  [AXIS_NO_STEP, AXIS_POSITIVE_STEP],
  [AXIS_NO_STEP, AXIS_NEGATIVE_STEP],
]

const flowContributionFromNeighbour = (
  here: number,
  neighbourHeight: number,
  dx: number,
  dz: number,
): readonly [number, number] => {
  const drop = here - neighbourHeight
  return [dx * drop, dz * drop]
}

const NO_FLOW_CONTRIBUTION: readonly [number, number] = [AXIS_NO_STEP, AXIS_NO_STEP]

const flowContributionFromLedge = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
  here: number,
  dx: number,
  dz: number,
): readonly [number, number] => {
  const neighbourId = getBlockAcrossBoundary(chunk, neighbours, lx + dx, y, lz + dz)
  if (neighbourId !== AIR) {
    return NO_FLOW_CONTRIBUTION
  }
  const belowHeight = heightAcross(chunk, neighbours, context, lx + dx, y - CELL_BELOW_STEP, lz + dz, blockId)
  if (belowHeight === NO_FLUID) {
    return NO_FLOW_CONTRIBUTION
  }
  const drop = here + CELL_BELOW_STEP - belowHeight
  return [dx * drop, dz * drop]
}

const flowContributionAt = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
  here: number,
  dx: number,
  dz: number,
): readonly [number, number] => {
  const neighbourHeight = heightAcross(chunk, neighbours, context, lx + dx, y, lz + dz, blockId)
  if (neighbourHeight !== NO_FLUID) {
    return flowContributionFromNeighbour(here, neighbourHeight, dx, dz)
  }
  return flowContributionFromLedge(chunk, neighbours, context, lx, y, lz, blockId, here, dx, dz)
}

const ZERO_FLOW_DIRECTION: readonly [number, number] = [AXIS_NO_STEP, AXIS_NO_STEP]

const flowDirectionOf = (flowX: number, flowZ: number, length: number): readonly [number, number] => {
  if (length === ZERO_FLOW_LENGTH) {
    return ZERO_FLOW_DIRECTION
  }
  return [flowX / length, flowZ / length]
}

export const flowAt = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
  here: number,
): FluidFlow => {
  let flowX = 0
  let flowZ = 0
  for (const [dx, dz] of FLOW_OFFSETS) {
    const [contributionX, contributionZ] = flowContributionAt(
      chunk,
      neighbours,
      context,
      lx,
      y,
      lz,
      blockId,
      here,
      dx,
      dz,
    )
    flowX += contributionX
    flowZ += contributionZ
  }
  const length = Math.hypot(flowX, flowZ)
  return {
    direction: flowDirectionOf(flowX, flowZ, length),
    falling: fallingIn(chunk.fluid, blockIndex(lx, y, lz, chunk.height)),
  }
}

const surfaceHeightOfColumn = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  const here = heightAcross(chunk, neighbours, context, lx, y, lz, wantId)
  if (here === NO_FLUID) {
    return NO_FLUID
  }
  const above = heightAcross(chunk, neighbours, context, lx, y + CELL_BELOW_STEP, lz, wantId)
  if (above === NO_FLUID) {
    return here
  }
  return FULL_HEIGHT
}

export const cornerHeight = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  cornerX: number,
  cornerZ: number,
  wantId: number,
): number => {
  let heightSum = 0
  let sampleCount = 0
  for (let sx = lx + cornerX - CORNER_WINDOW_START_OFFSET; sx <= lx + cornerX; sx += LOOP_STEP) {
    for (let sz = lz + cornerZ - CORNER_WINDOW_START_OFFSET; sz <= lz + cornerZ; sz += LOOP_STEP) {
      const height = surfaceHeightOfColumn(chunk, neighbours, context, sx, y, sz, wantId)
      if (height !== NO_FLUID) {
        heightSum += height
        sampleCount += LOOP_STEP
      }
    }
  }
  return heightSum / sampleCount
}

export const hidesFluidFace = (context: FluidContext, blockId: number): boolean =>
  occludes(context.layers, blockId) && !isFluidBlock(context.fluids, blockId) && !isCrossPlant(context.plants, blockId)
