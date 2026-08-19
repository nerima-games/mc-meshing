import { AIR, MAX_BLOCK_ID } from './block-data.js'
import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  type FluidView,
  blockIndex,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { type MeshConfig, occludes } from './opacity.js'
import type { FluidFlow } from './fluid-types.js'
import { isCrossPlant } from './plant-mesh.js'

const SOURCE_SURFACE_HEIGHT_NUMERATOR = 14
const SOURCE_SURFACE_HEIGHT_DENOMINATOR = 16
export const SOURCE_SURFACE_HEIGHT = SOURCE_SURFACE_HEIGHT_NUMERATOR / SOURCE_SURFACE_HEIGHT_DENOMINATOR

const NO_FLUID = -1
const INDEX_TO_COUNT_OFFSET = 1
const FLUID_LOOKUP_UNSET = 0
const MIN_BLOCK_ID = 0
const MIN_FLUID_LEVEL = 0
const MAX_FLUID_LEVEL = 0xff
const FULL_HEIGHT = 1
const ZERO_INDEX = 0
const CORNER_WINDOW_START_OFFSET = 1
const CHUNK_MAX_INDEX = CHUNK_SIZE - INDEX_TO_COUNT_OFFSET
const CELL_BELOW_STEP = 1
const AXIS_POSITIVE_STEP = 1
const AXIS_NEGATIVE_STEP = -1
const AXIS_NO_STEP = 0
const ZERO_FLOW_LENGTH = AXIS_NO_STEP

const FLOW_OFFSETS = [
  [AXIS_POSITIVE_STEP, AXIS_NO_STEP],
  [AXIS_NEGATIVE_STEP, AXIS_NO_STEP],
  [AXIS_NO_STEP, AXIS_POSITIVE_STEP],
  [AXIS_NO_STEP, AXIS_NEGATIVE_STEP],
] as const satisfies readonly [
  readonly [dx: number, dz: number],
  readonly [dx: number, dz: number],
  readonly [dx: number, dz: number],
  readonly [dx: number, dz: number],
]

const NO_FLOW_CONTRIBUTION: readonly [number, number] = [AXIS_NO_STEP, AXIS_NO_STEP]
const NO_FLOW_DIRECTION: readonly [number, number] = [AXIS_NO_STEP, AXIS_NO_STEP]

export const buildFluidLookup = (config: MeshConfig): Uint16Array => {
  const lookup = new Uint16Array(MAX_BLOCK_ID + INDEX_TO_COUNT_OFFSET)
  for (const [blockId, maxLevel] of config.fluidMaxLevels) {
    if (!Number.isInteger(blockId) || blockId < MIN_BLOCK_ID || blockId > MAX_BLOCK_ID) {
      throw new RangeError(`fluid block id must be an integer in [${MIN_BLOCK_ID}, ${MAX_BLOCK_ID}]: ${blockId}`)
    }
    if (!Number.isInteger(maxLevel) || maxLevel < MIN_FLUID_LEVEL || maxLevel > MAX_FLUID_LEVEL) {
      throw new RangeError(`fluid max level must be an integer in [${MIN_FLUID_LEVEL}, ${MAX_FLUID_LEVEL}]: ${maxLevel}`)
    }
    lookup[blockId] = maxLevel + INDEX_TO_COUNT_OFFSET
  }
  return lookup
}

export const isFluidBlock = (lookup: Uint16Array, blockId: number): boolean =>
  (lookup[blockId] ?? FLUID_LOOKUP_UNSET) !== FLUID_LOOKUP_UNSET

const maxLevelOf = (lookup: Uint16Array, blockId: number): number =>
  lookup[blockId]! - INDEX_TO_COUNT_OFFSET

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

export type FluidContext = {
  readonly fluids: Uint16Array
  readonly layers: Uint8Array
  readonly plants: Uint8Array
}

export type FluidSpace = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly context: FluidContext
}

export type FluidPosition = readonly [lx: number, y: number, lz: number]

export type FluidSample = {
  readonly space: FluidSpace
  readonly position: FluidPosition
  readonly blockId: number
  readonly here: number
}

const levelIn = (fluid: FluidView | undefined, index: number): number => {
  if (!fluid) {
    return FLUID_LOOKUP_UNSET
  }
  return fluid.levels[index] ?? FLUID_LOOKUP_UNSET
}

const sourceIn = (fluid: FluidView | undefined, index: number): boolean => {
  if (!fluid) {
    return false
  }
  return (fluid.sources[index] ?? FLUID_LOOKUP_UNSET) !== FLUID_LOOKUP_UNSET
}

const fallingIn = (fluid: FluidView | undefined, index: number): boolean => {
  if (!fluid) {
    return false
  }
  return (fluid.falling[index] ?? FLUID_LOOKUP_UNSET) !== FLUID_LOOKUP_UNSET
}

const heightInView = (view: ChunkView, context: FluidContext, position: FluidPosition, wantId: number): number => {
  const [lx, y, lz] = position
  if (getBlock(view.blocks, lx, y, lz, view.height) !== wantId) {
    return NO_FLUID
  }
  const index = blockIndex(lx, y, lz, view.height)
  return heightForLevel(
    levelIn(view.fluid, index),
    maxLevelOf(context.fluids, wantId),
    sourceIn(view.fluid, index),
  )
}

export const heightIn = (space: FluidSpace, position: FluidPosition, wantId: number): number =>
  heightInView(space.chunk, space.context, position, wantId)

const heightInNeighbour = (neighbour: ChunkView | undefined, context: FluidContext, position: FluidPosition, wantId: number): number => {
  if (!neighbour) {
    return NO_FLUID
  }
  return heightInView(neighbour, context, position, wantId)
}

const heightAcrossCorner = (space: FluidSpace, position: FluidPosition, wantId: number): number => {
  const { context, neighbours } = space
  const [lx, y, lz] = position
  if (lx < ZERO_INDEX && lz < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xNegZNeg, context, [CHUNK_MAX_INDEX, y, CHUNK_MAX_INDEX], wantId)
  }
  if (lx < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xNegZPos, context, [CHUNK_MAX_INDEX, y, ZERO_INDEX], wantId)
  }
  if (lz < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xPosZNeg, context, [ZERO_INDEX, y, CHUNK_MAX_INDEX], wantId)
  }
  return heightInNeighbour(neighbours.xPosZPos, context, [ZERO_INDEX, y, ZERO_INDEX], wantId)
}

const heightAcrossEdge = (space: FluidSpace, position: FluidPosition, wantId: number): number => {
  const { context, neighbours } = space
  const [lx, y, lz] = position
  if (lx < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xNeg, context, [CHUNK_MAX_INDEX, y, lz], wantId)
  }
  if (lx >= CHUNK_SIZE) {
    return heightInNeighbour(neighbours.xPos, context, [ZERO_INDEX, y, lz], wantId)
  }
  if (lz < ZERO_INDEX) {
    return heightInNeighbour(neighbours.zNeg, context, [lx, y, CHUNK_MAX_INDEX], wantId)
  }
  return heightInNeighbour(neighbours.zPos, context, [lx, y, ZERO_INDEX], wantId)
}

export const heightAcross = (space: FluidSpace, position: FluidPosition, wantId: number): number => {
  const [lx, , lz] = position
  const xOut = lx < ZERO_INDEX || lx >= CHUNK_SIZE
  const zOut = lz < ZERO_INDEX || lz >= CHUNK_SIZE
  if (xOut && zOut) {
    return heightAcrossCorner(space, position, wantId)
  }
  if (xOut || zOut) {
    return heightAcrossEdge(space, position, wantId)
  }
  return heightIn(space, position, wantId)
}

const flowContributionFromNeighbour = (
  here: number,
  neighbourHeight: number,
  direction: readonly [dx: number, dz: number],
): readonly [number, number] => {
  const [dx, dz] = direction
  const drop = here - neighbourHeight
  return [dx * drop, dz * drop]
}

const belowHeightOfLedge = (
  sample: FluidSample,
  direction: readonly [dx: number, dz: number],
  neighbourId: number,
): number => {
  if (neighbourId !== AIR) {
    return NO_FLUID
  }
  const [lx, y, lz] = sample.position
  const [dx, dz] = direction
  return heightAcross(sample.space, [lx + dx, y - CELL_BELOW_STEP, lz + dz], sample.blockId)
}

const flowContributionFromLedge = (sample: FluidSample, direction: readonly [dx: number, dz: number]): readonly [number, number] => {
  const { space, position, here } = sample
  const { chunk, neighbours } = space
  const [lx, y, lz] = position
  const [dx, dz] = direction
  const neighbourId = getBlockAcrossBoundary(chunk, neighbours, lx + dx, y, lz + dz)
  const belowHeight = belowHeightOfLedge(sample, direction, neighbourId)
  if (belowHeight === NO_FLUID) {
    return NO_FLOW_CONTRIBUTION
  }
  const drop = here + CELL_BELOW_STEP - belowHeight
  return [dx * drop, dz * drop]
}

const flowContributionAt = (sample: FluidSample, direction: readonly [dx: number, dz: number]): readonly [number, number] => {
  const [lx, y, lz] = sample.position
  const [dx, dz] = direction
  const neighbourHeight = heightAcross(sample.space, [lx + dx, y, lz + dz], sample.blockId)
  if (neighbourHeight !== NO_FLUID) {
    return flowContributionFromNeighbour(sample.here, neighbourHeight, direction)
  }
  return flowContributionFromLedge(sample, direction)
}

const flowDirectionOf = (flowX: number, flowZ: number, length: number): readonly [number, number] => {
  if (length === ZERO_FLOW_LENGTH) {
    return NO_FLOW_DIRECTION
  }
  return [flowX / length, flowZ / length]
}

export const flowAt = (sample: FluidSample): FluidFlow => {
  let flowX = 0
  let flowZ = 0
  for (const [dx, dz] of FLOW_OFFSETS) {
    const [contributionX, contributionZ] = flowContributionAt(sample, [dx, dz])
    flowX += contributionX
    flowZ += contributionZ
  }

  const length = Math.hypot(flowX, flowZ)
  const [lx, y, lz] = sample.position
  return {
    direction: flowDirectionOf(flowX, flowZ, length),
    falling: fallingIn(sample.space.chunk.fluid, blockIndex(lx, y, lz, sample.space.chunk.height)),
  }
}

const surfaceHeightOfColumn = (space: FluidSpace, position: FluidPosition, wantId: number): number => {
  const here = heightAcross(space, position, wantId)
  if (here === NO_FLUID) {
    return NO_FLUID
  }
  const [lx, y, lz] = position
  if (heightAcross(space, [lx, y + CELL_BELOW_STEP, lz], wantId) === NO_FLUID) {
    return here
  }
  return FULL_HEIGHT
}

export const cornerHeight = (
  space: FluidSpace,
  position: FluidPosition,
  corner: readonly [cornerX: number, cornerZ: number],
  wantId: number,
): number => {
  const [lx, y, lz] = position
  const [cornerX, cornerZ] = corner
  let heightSum = 0
  let sampleCount = 0
  for (let sx = lx + cornerX - CORNER_WINDOW_START_OFFSET; sx <= lx + cornerX; sx += INDEX_TO_COUNT_OFFSET) {
    for (let sz = lz + cornerZ - CORNER_WINDOW_START_OFFSET; sz <= lz + cornerZ; sz += INDEX_TO_COUNT_OFFSET) {
      const height = surfaceHeightOfColumn(space, [sx, y, sz], wantId)
      heightSum += Math.max(height, FLUID_LOOKUP_UNSET)
      sampleCount += Number(height !== NO_FLUID) * INDEX_TO_COUNT_OFFSET
    }
  }
  return heightSum / sampleCount
}

export const hidesFluidFace = (context: FluidContext, blockId: number): boolean =>
  occludes(context.layers, blockId) &&
  !isFluidBlock(context.fluids, blockId) &&
  !isCrossPlant(context.plants, blockId)
