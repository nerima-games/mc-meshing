import { Result } from 'effect'
import { BlockId as KernelBlockId } from '@nerima-games/mc-kernel'
import { AIR, MAX_BLOCK_ID, type BlockId } from './block-data.js'
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
export const SOURCE_SURFACE_HEIGHT: number = SOURCE_SURFACE_HEIGHT_NUMERATOR / SOURCE_SURFACE_HEIGHT_DENOMINATOR

const NO_FLUID = -1
const INDEX_TO_COUNT_OFFSET = 1
const FLUID_LOOKUP_UNSET = 0
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

type BlockIdValidationFailure = ReturnType<typeof KernelBlockId.result> extends Result.Result<
  BlockId,
  infer Failure
>
  ? Failure
  : never

export type FluidLookupFailure =
  | BlockIdValidationFailure
  | { readonly _tag: 'InvalidFluidLookupLength'; readonly actual: number; readonly expected: number }
  | { readonly _tag: 'InvalidFluidMaxLevel'; readonly blockId: BlockId; readonly maxLevel: number }
  | { readonly _tag: 'MissingFluidLookupEntry'; readonly blockId: BlockId }

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
  const views = [chunk, ...Object.values(neighbours)]
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

/**
 * Exported so the defensive branch (a `blockId` genuinely absent from
 * `lookup`, which every caller only reaches after `isFluidBlock` has already
 * confirmed presence) has a direct test instead of an untestable one buried
 * inside callers that never violate that precondition.
 */
export const maxLevelOf = (lookup: Uint16Array, blockId: BlockId): Result.Result<number, FluidLookupFailure> => {
  const expectedLength = MAX_BLOCK_ID + INDEX_TO_COUNT_OFFSET
  if (lookup.length !== expectedLength) {
    return Result.fail({ _tag: 'InvalidFluidLookupLength', actual: lookup.length, expected: expectedLength })
  }
  const validBlockId = KernelBlockId.result(blockId)
  if (Result.isFailure(validBlockId)) {
    return Result.fail(validBlockId.failure)
  }
  const entry = lookup[validBlockId.success]
  if (typeof entry === 'undefined' || entry === FLUID_LOOKUP_UNSET) {
    return Result.fail({ _tag: 'MissingFluidLookupEntry', blockId: validBlockId.success })
  }
  return Result.succeed(entry - INDEX_TO_COUNT_OFFSET)
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
}

export type FluidPosition = readonly [lx: number, y: number, lz: number]

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
  return heightForLevel(
    levelIn(fluid, index),
    encodedLevelForKnownFluid(space.context.fluids, wantId) - INDEX_TO_COUNT_OFFSET,
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
  return {
    direction: flowDirectionOf(flowX, flowZ, length),
    falling: fallingIn(fluidViewIn(sample.space, sample.space.chunk), blockIndex(lx, y, lz, sample.space.chunk.height)),
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
