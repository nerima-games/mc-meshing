import { CHUNK_SIZE, type ChunkNeighbours, type ChunkView, blockIndex } from './chunk-view.js'
import { LIGHT_LEVEL_MAX, type LightView, type QuadLight, clampMeshLight } from './light-types.js'
import type { FaceDirection } from './faces.js'

export type LightSample = {
  readonly block: number
  readonly sky: number
}

type HorizontalLightTarget = {
  readonly chunk: ChunkView
  readonly lx: number
  readonly lz: number
}

type LightTargetQuery = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly lx: number
  readonly lz: number
}

type HorizontalNeighbourQuery = {
  readonly neighbours: ChunkNeighbours
  readonly xOutside: boolean
  readonly xPositive: boolean
  readonly zOutside: boolean
  readonly zPositive: boolean
}

type BoundaryLightTargetQuery = HorizontalNeighbourQuery & {
  readonly lx: number
  readonly lz: number
}

type LocalCoordinatesQuery = Pick<BoundaryLightTargetQuery, 'lx' | 'lz' | 'xOutside' | 'xPositive' | 'zOutside' | 'zPositive'>

type ChunkLightQuery = {
  readonly chunk: ChunkView
  readonly light: LightView
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly fallback: LightSample
}

const LIGHT_LEVEL_MIN = 0
const CELL_ORIGIN = 0
const CELL_STEP = 1
const ZERO_LIGHT: LightSample = Object.freeze({ block: LIGHT_LEVEL_MIN, sky: LIGHT_LEVEL_MIN })
const OPEN_SKY_LIGHT: LightSample = Object.freeze({ block: LIGHT_LEVEL_MIN, sky: LIGHT_LEVEL_MAX })

const diagonalNeighbourAt = ({ neighbours, xPositive, zPositive }: Pick<HorizontalNeighbourQuery, 'neighbours' | 'xPositive' | 'zPositive'>): ChunkView | undefined => {
  if (xPositive) {
    if (zPositive) {
      return neighbours.xPosZPos
    }
    return neighbours.xPosZNeg
  }
  if (zPositive) {
    return neighbours.xNegZPos
  }
  return neighbours.xNegZNeg
}

const horizontalNeighbourAt = ({ neighbours, xOutside, xPositive, zOutside, zPositive }: HorizontalNeighbourQuery): ChunkView | undefined => {
  if (xOutside && zOutside) {
    return diagonalNeighbourAt({ neighbours, xPositive, zPositive })
  }
  if (xOutside) {
    if (xPositive) {
      return neighbours.xPos
    }
    return neighbours.xNeg
  }
  if (zPositive) {
    return neighbours.zPos
  }
  return neighbours.zNeg
}

const localCoordinate = (coordinate: number, positive: boolean): number => {
  if (positive) {
    return coordinate - CHUNK_SIZE
  }
  return coordinate + CHUNK_SIZE
}

const localCoordinatesAt = ({ lx, lz, xOutside, xPositive, zOutside, zPositive }: LocalCoordinatesQuery): Pick<HorizontalLightTarget, 'lx' | 'lz'> => {
  let targetLx = lx
  if (xOutside) {
    targetLx = localCoordinate(lx, xPositive)
  }
  let targetLz = lz
  if (zOutside) {
    targetLz = localCoordinate(lz, zPositive)
  }
  return { lx: targetLx, lz: targetLz }
}

const boundaryLightTargetAt = ({ lx, lz, neighbours, xOutside, xPositive, zOutside, zPositive }: BoundaryLightTargetQuery): HorizontalLightTarget | undefined => {
  const target = horizontalNeighbourAt({ neighbours, xOutside, xPositive, zOutside, zPositive })

  if (!target) {
    return
  }

  const { lx: targetLx, lz: targetLz } = localCoordinatesAt({ lx, lz, xOutside, xPositive, zOutside, zPositive })

  return {
    chunk: target,
    lx: targetLx,
    lz: targetLz,
  }
}

const lightTargetAt = ({ chunk, neighbours, lx, lz }: LightTargetQuery): HorizontalLightTarget | undefined => {
  const xOutside = lx < CELL_ORIGIN || lx >= CHUNK_SIZE
  const zOutside = lz < CELL_ORIGIN || lz >= CHUNK_SIZE
  if (!xOutside && !zOutside) {
    return { chunk, lx, lz }
  }

  const xPositive = lx >= CHUNK_SIZE
  const zPositive = lz >= CHUNK_SIZE
  return boundaryLightTargetAt({ lx, lz, neighbours, xOutside, xPositive, zOutside, zPositive })
}

const readLight = (
  values: Readonly<Uint8Array>,
  index: number,
  fallback: number,
): number => {
  // A `Uint8Array` read at a negative index or past its length both yield
  // `undefined` in JS (verified: no throw, no wraparound), so the one
  // `index < CELL_ORIGIN || index >= values.length` check this used to be is
  // exactly what checking `value` already covers — one branch, not two.
  const value = values[index]
  if (typeof value === 'undefined') {
    return fallback
  }
  return clampMeshLight(value)
}

const sampleLightInChunk = ({ chunk, light, lx, y, lz, fallback }: ChunkLightQuery): LightSample => {
  if (y >= chunk.height) {
    return OPEN_SKY_LIGHT
  }

  const index = blockIndex(lx, y, lz, chunk.height)
  return {
    block: readLight(light.blockLight, index, fallback.block),
    sky: readLight(light.skyLight, index, fallback.sky),
  }
}

type SampleLightArguments = readonly [ChunkView, ChunkNeighbours, number, number, number]

export const sampleLightAt = (...args: SampleLightArguments): LightSample => {
  const [chunk, neighbours, lx, y, lz] = args
  if (y < CELL_ORIGIN) {
    return ZERO_LIGHT
  }

  const target = lightTargetAt({ chunk, lx, lz, neighbours })
  if (!target) {
    return OPEN_SKY_LIGHT
  }

  const { light } = target.chunk
  if (!light) {
    return OPEN_SKY_LIGHT
  }
  return sampleLightInChunk({ chunk: target.chunk, fallback: OPEN_SKY_LIGHT, light, lx: target.lx, lz: target.lz, y })
}

/** A 3D grid offset. */
type Offset = readonly [number, number, number]

/** The four corner offsets for one face direction, as a fixed 4-tuple so each position is indexable without `T | undefined`. */
type CornerOffsets = readonly [Offset, Offset, Offset, Offset]

const CORNER_OFFSETS: Readonly<Record<FaceDirection, CornerOffsets>> = {
  xNeg: [[CELL_ORIGIN, CELL_ORIGIN, CELL_STEP], [CELL_ORIGIN, CELL_STEP, CELL_STEP], [CELL_ORIGIN, CELL_STEP, CELL_ORIGIN], [CELL_ORIGIN, CELL_ORIGIN, CELL_ORIGIN]],
  xPos: [[CELL_ORIGIN, CELL_ORIGIN, CELL_ORIGIN], [CELL_ORIGIN, CELL_STEP, CELL_ORIGIN], [CELL_ORIGIN, CELL_STEP, CELL_STEP], [CELL_ORIGIN, CELL_ORIGIN, CELL_STEP]],
  yNeg: [[CELL_ORIGIN, CELL_ORIGIN, CELL_STEP], [CELL_ORIGIN, CELL_ORIGIN, CELL_ORIGIN], [CELL_STEP, CELL_ORIGIN, CELL_ORIGIN], [CELL_STEP, CELL_ORIGIN, CELL_STEP]],
  yPos: [[CELL_ORIGIN, CELL_ORIGIN, CELL_ORIGIN], [CELL_ORIGIN, CELL_ORIGIN, CELL_STEP], [CELL_STEP, CELL_ORIGIN, CELL_STEP], [CELL_STEP, CELL_ORIGIN, CELL_ORIGIN]],
  zNeg: [[CELL_ORIGIN, CELL_ORIGIN, CELL_ORIGIN], [CELL_ORIGIN, CELL_STEP, CELL_ORIGIN], [CELL_STEP, CELL_STEP, CELL_ORIGIN], [CELL_STEP, CELL_ORIGIN, CELL_ORIGIN]],
  zPos: [[CELL_STEP, CELL_ORIGIN, CELL_ORIGIN], [CELL_STEP, CELL_STEP, CELL_ORIGIN], [CELL_ORIGIN, CELL_STEP, CELL_ORIGIN], [CELL_ORIGIN, CELL_ORIGIN, CELL_ORIGIN]],
}

type QuadLightArguments = readonly [ChunkView, ChunkNeighbours, FaceDirection, number, number, number]

export const quadLightAt = (...args: QuadLightArguments): QuadLight | undefined => {
  const [chunk, neighbours, direction, lx, y, lz] = args
  if (!chunk.light) {
    return
  }

  const [firstOffset, secondOffset, thirdOffset, fourthOffset] = CORNER_OFFSETS[direction]
  const first = sampleLightAt(chunk, neighbours, lx + firstOffset[0], y + firstOffset[1], lz + firstOffset[2])
  const second = sampleLightAt(chunk, neighbours, lx + secondOffset[0], y + secondOffset[1], lz + secondOffset[2])
  const third = sampleLightAt(chunk, neighbours, lx + thirdOffset[0], y + thirdOffset[1], lz + thirdOffset[2])
  const fourth = sampleLightAt(chunk, neighbours, lx + fourthOffset[0], y + fourthOffset[1], lz + fourthOffset[2])

  return {
    block: [first.block, second.block, third.block, fourth.block],
    sky: [first.sky, second.sky, third.sky, fourth.sky],
  }
}
