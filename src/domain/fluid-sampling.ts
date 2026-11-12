import { Result } from 'effect'
import {
  BlockId as KernelBlockId,
  FLUID_LEVEL_MAX,
  FLOWING_FLUID_LEVEL,
  blockTypeOfId,
  type EffectiveBlockStateValues,
} from '@nerima-games/mc-kernel'
import { AIR, MAX_BLOCK_ID, type BlockId } from './block-data.js'
import {
  CHUNK_SIZE,
  type ChunkBlockIndex,
  type ChunkNeighbours,
  type ChunkView,
  type ChunkViewFailure,
  type FluidView,
  blockIndex,
  blockStateAt,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { type MeshConfig, occludes } from './opacity.js'
import type { FluidFlow } from './fluid-types.js'
import { isCrossPlant } from './plant-mesh.js'

const SOURCE_SURFACE_HEIGHT_NUMERATOR = 14
const SOURCE_SURFACE_HEIGHT_DENOMINATOR = 16
export const SOURCE_SURFACE_HEIGHT: number = SOURCE_SURFACE_HEIGHT_NUMERATOR / SOURCE_SURFACE_HEIGHT_DENOMINATOR

const NO_FLUID = -1
const INDEX_TO_COUNT_OFFSET = 1
const FLUID_LOOKUP_UNSET = 0
const MIN_FLUID_LEVEL = 0
const MAX_FLUID_LEVEL = 0xff
const MAX_FLUID_STATE_LEVEL = FLUID_LEVEL_MAX
const FULL_HEIGHT = 1
const ZERO_INDEX = 0
const CORNER_WINDOW_START_OFFSET = 1
const CHUNK_MAX_INDEX = CHUNK_SIZE - INDEX_TO_COUNT_OFFSET
const CELL_BELOW_STEP = 1
const AXIS_POSITIVE_STEP = 1
const AXIS_NEGATIVE_STEP = -1
const AXIS_NO_STEP = 0
const ZERO_FLOW_LENGTH = AXIS_NO_STEP
const FIRST_FALLING_FLUID_LEVEL = FLOWING_FLUID_LEVEL + 1

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

type BlockIdValidationFailure = ReturnType<typeof KernelBlockId.result> extends Result.Result<
  BlockId,
  infer Failure
>
  ? Failure
  : never

export type FluidLookupFailure =
  | BlockIdValidationFailure
  | { readonly _tag: 'InvalidFluidMaxLevel'; readonly blockId: BlockId; readonly maxLevel: number }

export type FluidViewFailure =
  | {
      readonly _tag: 'IncompleteFluidView'
      readonly actual: number
      readonly coord: ChunkView['coord']
      readonly expected: number
      readonly field: 'falling' | 'levels' | 'sources'
    }
  | {
      readonly _tag: 'InvalidFluidView'
      readonly coord: ChunkView['coord']
      readonly field: 'falling' | 'fluid' | 'levels' | 'sources'
    }

export type FluidSamplingFailure =
  | ChunkViewFailure
  | {
      readonly _tag: 'InvalidFluidBlockStateLevel'
      readonly blockId: BlockId
      readonly index: ChunkBlockIndex
      readonly level: unknown
    }

const FLUID_LOOKUP_DATA_VIEWS = new WeakMap<Uint16Array, DataView>()
const FLUID_ARRAY_DATA_VIEWS = new WeakMap<Readonly<Uint8Array>, DataView>()
const ENDIANNESS_MARKER = new Uint16Array([1])
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(ENDIANNESS_MARKER.buffer)[ZERO_INDEX] === 1

const dataViewForLookup = (lookup: Uint16Array): DataView => {
  const cached = FLUID_LOOKUP_DATA_VIEWS.get(lookup)
  if (cached) {
    return cached
  }
  const view = new DataView(lookup.buffer, lookup.byteOffset, lookup.byteLength)
  FLUID_LOOKUP_DATA_VIEWS.set(lookup, view)
  return view
}

const dataViewForFluidArray = (values: Readonly<Uint8Array>): DataView => {
  const cached = FLUID_ARRAY_DATA_VIEWS.get(values)
  if (cached) {
    return cached
  }
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength)
  FLUID_ARRAY_DATA_VIEWS.set(values, view)
  return view
}

const encodedLevelForKnownFluid = (lookup: Uint16Array, blockId: BlockId): number =>
  dataViewForLookup(lookup).getUint16(blockId * Uint16Array.BYTES_PER_ELEMENT, HOST_IS_LITTLE_ENDIAN)

export const validateFluidViews = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
): Result.Result<ReadonlyMap<ChunkView, FluidView>, FluidViewFailure> => {
  const validated = new Map<ChunkView, FluidView>()
  const views = [
    chunk,
    neighbours.xPos,
    neighbours.xNeg,
    neighbours.zPos,
    neighbours.zNeg,
    neighbours.xPosZPos,
    neighbours.xPosZNeg,
    neighbours.xNegZPos,
    neighbours.xNegZNeg,
  ]
  for (const view of views) {
    if (typeof view === 'undefined') {
      continue
    }
    const fluid: FluidView | null | undefined = view.fluid
    if (typeof fluid === 'undefined') {
      continue
    }
    if (fluid === null) {
      return Result.fail({ _tag: 'InvalidFluidView', coord: view.coord, field: 'fluid' })
    }
    const levels: Readonly<Uint8Array> | null | undefined = fluid.levels
    const sources: Readonly<Uint8Array> | null | undefined = fluid.sources
    const falling: Readonly<Uint8Array> | null | undefined = fluid.falling
    if (typeof levels === 'undefined' || levels === null) {
      return Result.fail({ _tag: 'InvalidFluidView', coord: view.coord, field: 'levels' })
    }
    if (typeof sources === 'undefined' || sources === null) {
      return Result.fail({ _tag: 'InvalidFluidView', coord: view.coord, field: 'sources' })
    }
    if (typeof falling === 'undefined' || falling === null) {
      return Result.fail({ _tag: 'InvalidFluidView', coord: view.coord, field: 'falling' })
    }
    const expected = CHUNK_SIZE * view.height * CHUNK_SIZE
    const arrays = [
      ['levels', levels],
      ['sources', sources],
      ['falling', falling],
    ] as const
    for (const [field, values] of arrays) {
      if (!(values instanceof Uint8Array)) {
        return Result.fail({ _tag: 'InvalidFluidView', coord: view.coord, field })
      }
      if (values.length < expected) {
        return Result.fail({
          _tag: 'IncompleteFluidView',
          actual: values.length,
          coord: view.coord,
          expected,
          field,
        })
      }
    }
    validated.set(view, { levels, sources, falling })
  }
  return Result.succeed(validated)
}

export const buildFluidLookup = (config: MeshConfig): Result.Result<Uint16Array, FluidLookupFailure> => {
  const lookup = new Uint16Array(MAX_BLOCK_ID + INDEX_TO_COUNT_OFFSET)
  for (const [blockId, maxLevel] of config.fluidMaxLevels) {
    const validBlockId = KernelBlockId.result(blockId)
    if (Result.isFailure(validBlockId)) {
      return Result.fail(validBlockId.failure)
    }
    if (!Number.isInteger(maxLevel) || maxLevel < MIN_FLUID_LEVEL || maxLevel > MAX_FLUID_LEVEL) {
      return Result.fail({ _tag: 'InvalidFluidMaxLevel', blockId: validBlockId.success, maxLevel })
    }
    lookup[validBlockId.success] = maxLevel + INDEX_TO_COUNT_OFFSET
  }
  dataViewForLookup(lookup)
  return Result.succeed(lookup)
}

export const isFluidBlock = (lookup: Uint16Array, blockId: BlockId): boolean => {
  const entry = lookup[blockId]
  return typeof entry !== 'undefined' && entry !== FLUID_LOOKUP_UNSET
}

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
  readonly fluidViews?: ReadonlyMap<ChunkView, FluidView>
  readonly blockStateSamples?: Map<ChunkView, Map<ChunkBlockIndex, FluidBlockStateSample | null>>
  readonly stateFailure: { failure: FluidSamplingFailure | null }
}

type FluidBlockStateSample = {
  readonly blockState: EffectiveBlockStateValues
  readonly falling: boolean
  readonly level: number
  readonly maximum: number
  readonly source: boolean
}

export type FluidPosition = readonly [lx: number, y: number, lz: number]

const FLUID_MAXIMUM_LEVELS_BY_SPACE = new WeakMap<FluidSpace, Map<BlockId, number>>()

const maximumLevelForFluidIn = (space: FluidSpace, blockId: BlockId): number => {
  let maximumLevels = FLUID_MAXIMUM_LEVELS_BY_SPACE.get(space)
  if (!maximumLevels) {
    maximumLevels = new Map()
    FLUID_MAXIMUM_LEVELS_BY_SPACE.set(space, maximumLevels)
  }
  const cached = maximumLevels.get(blockId)
  if (typeof cached !== 'undefined') {
    return cached
  }
  const maximum = encodedLevelForKnownFluid(space.context.fluids, blockId) - INDEX_TO_COUNT_OFFSET
  maximumLevels.set(blockId, maximum)
  return maximum
}

export type FluidSample = {
  readonly space: FluidSpace
  readonly position: FluidPosition
  readonly blockId: BlockId
  readonly here: number
}

const fluidArrayValueAt = (values: Readonly<Uint8Array>, index: number): number =>
  dataViewForFluidArray(values).getUint8(index)

const fluidViewIn = (space: FluidSpace, view: ChunkView): FluidView | undefined => {
  const fluidViews = space.fluidViews
  if (typeof fluidViews !== 'undefined') {
    return fluidViews.get(view)
  }
  return view.fluid
}

const levelIn = (fluid: FluidView | undefined, index: number): number => {
  if (!fluid) {
    return FLUID_LOOKUP_UNSET
  }
  // Mesh entry points validate complete present views before sampling.
  return fluidArrayValueAt(fluid.levels, index)
}

const sourceIn = (fluid: FluidView | undefined, index: number): boolean => {
  if (!fluid) {
    return false
  }
  return fluidArrayValueAt(fluid.sources, index) !== FLUID_LOOKUP_UNSET
}

const fallingIn = (fluid: FluidView | undefined, index: number): boolean => {
  if (!fluid) {
    return false
  }
  return fluidArrayValueAt(fluid.falling, index) !== FLUID_LOOKUP_UNSET
}

const blockStateSampleCacheFor = (
  space: FluidSpace,
  view: ChunkView,
): Map<ChunkBlockIndex, FluidBlockStateSample | null> | undefined => {
  const samples = space.blockStateSamples
  let viewSamples = samples?.get(view)
  if (samples && !viewSamples) {
    viewSamples = new Map()
    samples.set(view, viewSamples)
  }
  return viewSamples
}

const keepFirstStateFailure = (space: FluidSpace, failure: FluidSamplingFailure): void => {
  if (space.stateFailure.failure === null) {
    space.stateFailure.failure = failure
  }
}

const rememberNoFluidSample = (
  viewSamples: Map<ChunkBlockIndex, FluidBlockStateSample | null> | undefined,
  index: ChunkBlockIndex,
): null => {
  viewSamples?.set(index, null)
  return null
}

const isFluidBlockType = (blockType: string | undefined): boolean => blockType === 'water' || blockType === 'lava'

const isFluidStateLevel = (rawLevel: unknown): rawLevel is number =>
  typeof rawLevel === 'number' && Number.isInteger(rawLevel) &&
  rawLevel >= MIN_FLUID_LEVEL && rawLevel <= MAX_FLUID_STATE_LEVEL

const stateSampleFor = (
  space: FluidSpace,
  view: ChunkView,
  index: ChunkBlockIndex,
  blockId: BlockId,
): FluidBlockStateSample | null => {
  const viewSamples = blockStateSampleCacheFor(space, view)
  if (viewSamples?.has(index)) {
    return viewSamples.get(index) ?? null
  }

  const blockType = blockTypeOfId(blockId)
  if (Result.isFailure(blockType) || typeof blockType.success !== 'string') {
    const state = blockStateAt(view, index)
    if (Result.isFailure(state)) {
      keepFirstStateFailure(space, state.failure)
    }
    return rememberNoFluidSample(viewSamples, index)
  }
  if (!isFluidBlockType(blockType.success)) {
    return rememberNoFluidSample(viewSamples, index)
  }

  const state = blockStateAt(view, index)
  if (Result.isFailure(state)) {
    keepFirstStateFailure(space, state.failure)
    return rememberNoFluidSample(viewSamples, index)
  }

  const rawLevel = state.success.level
  if (!isFluidStateLevel(rawLevel)) {
    keepFirstStateFailure(space, { _tag: 'InvalidFluidBlockStateLevel', blockId, index, level: rawLevel })
    return rememberNoFluidSample(viewSamples, index)
  }
  const maximum = maximumLevelForFluidIn(space, blockId)
  const level = Math.min(maximum, Math.ceil((rawLevel * maximum) / FLOWING_FLUID_LEVEL))
  const sample: FluidBlockStateSample = {
    blockState: state.success,
    falling: rawLevel >= FIRST_FALLING_FLUID_LEVEL,
    level,
    maximum,
    source: rawLevel === ZERO_INDEX,
  }
  viewSamples?.set(index, sample)
  return sample
}

export const blockStateIn = (
  space: FluidSpace,
  position: FluidPosition,
  wantId: BlockId,
): EffectiveBlockStateValues | undefined => {
  const [lx, y, lz] = position
  const view = space.chunk
  return stateSampleFor(space, view, blockIndex(lx, y, lz, view.height), wantId)?.blockState
}

const heightInView = (space: FluidSpace, view: ChunkView, position: FluidPosition, wantId: BlockId): number => {
  const [lx, y, lz] = position
  if (getBlock(view, lx, y, lz) !== wantId) {
    return NO_FLUID
  }
  if (!isFluidBlock(space.context.fluids, wantId)) {
    return NO_FLUID
  }
  const index = blockIndex(lx, y, lz, view.height)
  const fluid = fluidViewIn(space, view)
  if (typeof view.blockStates !== 'undefined' || typeof fluid === 'undefined') {
    const state = stateSampleFor(space, view, index, wantId)
    if (state) {
      if (state.falling) {
        return FULL_HEIGHT
      }
      return heightForLevel(state.level, state.maximum, state.source)
    }
  }
  return heightForLevel(
    levelIn(fluid, index),
    maximumLevelForFluidIn(space, wantId),
    sourceIn(fluid, index),
  )
}

export const heightIn = (space: FluidSpace, position: FluidPosition, wantId: BlockId): number =>
  heightInView(space, space.chunk, position, wantId)

const heightInNeighbour = (neighbour: ChunkView | undefined, space: FluidSpace, position: FluidPosition, wantId: BlockId): number => {
  if (!neighbour) {
    return NO_FLUID
  }
  return heightInView(space, neighbour, position, wantId)
}

const heightAcrossCorner = (space: FluidSpace, position: FluidPosition, wantId: BlockId): number => {
  const { neighbours } = space
  const [lx, y, lz] = position
  if (lx < ZERO_INDEX && lz < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xNegZNeg, space, [CHUNK_MAX_INDEX, y, CHUNK_MAX_INDEX], wantId)
  }
  if (lx < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xNegZPos, space, [CHUNK_MAX_INDEX, y, ZERO_INDEX], wantId)
  }
  if (lz < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xPosZNeg, space, [ZERO_INDEX, y, CHUNK_MAX_INDEX], wantId)
  }
  return heightInNeighbour(neighbours.xPosZPos, space, [ZERO_INDEX, y, ZERO_INDEX], wantId)
}

const heightAcrossEdge = (space: FluidSpace, position: FluidPosition, wantId: BlockId): number => {
  const { neighbours } = space
  const [lx, y, lz] = position
  if (lx < ZERO_INDEX) {
    return heightInNeighbour(neighbours.xNeg, space, [CHUNK_MAX_INDEX, y, lz], wantId)
  }
  if (lx >= CHUNK_SIZE) {
    return heightInNeighbour(neighbours.xPos, space, [ZERO_INDEX, y, lz], wantId)
  }
  if (lz < ZERO_INDEX) {
    return heightInNeighbour(neighbours.zNeg, space, [lx, y, CHUNK_MAX_INDEX], wantId)
  }
  return heightInNeighbour(neighbours.zPos, space, [lx, y, ZERO_INDEX], wantId)
}

export const heightAcross = (space: FluidSpace, position: FluidPosition, wantId: BlockId): number => {
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
  const view = sample.space.chunk
  const index = blockIndex(lx, y, lz, view.height)
  const fluid = fluidViewIn(sample.space, view)
  const state = (typeof view.blockStates !== 'undefined' || typeof fluid === 'undefined')
    ? stateSampleFor(sample.space, view, index, sample.blockId)
    : null
  return {
    direction: flowDirectionOf(flowX, flowZ, length),
    falling: state?.falling ?? fallingIn(fluid, index),
  }
}

const surfaceHeightOfColumn = (space: FluidSpace, position: FluidPosition, wantId: BlockId): number => {
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
  wantId: BlockId,
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

export const hidesFluidFace = (context: FluidContext, blockId: BlockId): boolean =>
  occludes(context.layers, blockId) &&
  !isFluidBlock(context.fluids, blockId) &&
  !isCrossPlant(context.plants, blockId)
