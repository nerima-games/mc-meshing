/* oxlint-disable no-magic-numbers -- Vanilla block-model coordinates and rotations are protocol-defined literals. */

import type { FaceDirection } from './faces.js'
import type { RailShape } from './rail-types.js'
import type { SpecialVertex } from './special-types.js'

export type RailFaceDirection = Extract<FaceDirection, 'yPos' | 'yNeg'>

type RailPlanePoint = readonly [x: number, z: number]

type RailPlane = readonly [RailPlanePoint, RailPlanePoint, RailPlanePoint, RailPlanePoint]

const UNIT_START = 0
const UNIT_END = 1
const TWO = 2
const RAIL_MODEL_UNITS = 16
const RAIL_SLOPE_ORIGIN_MODEL_Y = 9
const NO_ROTATION = 0 as const
const QUARTER_TURN_DEGREES = 90 as const
const HALF_TURN_DEGREES = 180
const POSITIVE_SLOPE_ANGLE = 45 as const
const NEGATIVE_SLOPE_ANGLE = -45 as const
const HALF_BLOCK = UNIT_END / TWO
const RAIL_FLAT_HEIGHT = UNIT_END / RAIL_MODEL_UNITS
const RAIL_SLOPE_ORIGIN_HEIGHT = RAIL_SLOPE_ORIGIN_MODEL_Y / RAIL_MODEL_UNITS
const ROUNDING_SCALE = 100_000_000
const RADIANS_PER_DEGREE = Math.PI / HALF_TURN_DEGREES
const QUARTER_TURN_RADIANS = Math.PI / TWO

const RAIL_PLANES: Readonly<Record<RailFaceDirection, RailPlane>> = {
  yNeg: [
    [UNIT_START, UNIT_START],
    [UNIT_END, UNIT_START],
    [UNIT_END, UNIT_END],
    [UNIT_START, UNIT_END],
  ],
  yPos: [
    [UNIT_START, UNIT_END],
    [UNIT_END, UNIT_END],
    [UNIT_END, UNIT_START],
    [UNIT_START, UNIT_START],
  ],
}

type RailSlopeTransform = {
  readonly angle: typeof POSITIVE_SLOPE_ANGLE | typeof NEGATIVE_SLOPE_ANGLE
  readonly yRotation: typeof NO_ROTATION | typeof QUARTER_TURN_DEGREES
}

const RAIL_SLOPE_TRANSFORMS: Partial<Record<RailShape, RailSlopeTransform>> = {
  ascending_east: { angle: POSITIVE_SLOPE_ANGLE, yRotation: QUARTER_TURN_DEGREES },
  ascending_north: { angle: POSITIVE_SLOPE_ANGLE, yRotation: NO_ROTATION },
  ascending_south: { angle: NEGATIVE_SLOPE_ANGLE, yRotation: NO_ROTATION },
  ascending_west: { angle: NEGATIVE_SLOPE_ANGLE, yRotation: QUARTER_TURN_DEGREES },
}

const rounded = (value: number): number => {
  const result = Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE
  if (result === UNIT_START) {
    return UNIT_START
  }
  return result
}

const rotateAroundX = (
  y: number,
  z: number,
  angle: number,
): readonly [number, number] => {
  const originY = RAIL_SLOPE_ORIGIN_HEIGHT
  const originZ = HALF_BLOCK
  const radians = angle * RADIANS_PER_DEGREE
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const rescale = UNIT_END / Math.abs(cosine)
  const relativeY = (y - originY) * rescale
  const relativeZ = (z - originZ) * rescale
  return [
    originY + relativeY * cosine - relativeZ * sine,
    originZ + relativeY * sine + relativeZ * cosine,
  ]
}

const rotateAroundY = (
  x: number,
  z: number,
  yRotation: typeof NO_ROTATION | typeof QUARTER_TURN_DEGREES,
): readonly [number, number] => {
  if (yRotation === NO_ROTATION) {
    return [x, z]
  }
  const cosine = Math.cos(QUARTER_TURN_RADIANS)
  const sine = Math.sin(QUARTER_TURN_RADIANS)
  const relativeX = x - HALF_BLOCK
  const relativeZ = z - HALF_BLOCK
  return [
    HALF_BLOCK + relativeX * cosine - relativeZ * sine,
    HALF_BLOCK + relativeX * sine + relativeZ * cosine,
  ]
}

const raisedRailPointOf = (
  point: RailPlanePoint,
  transform: RailSlopeTransform,
): readonly [number, number, number] => {
  const [pointX, pointZ] = point
  const rotated = rotateAroundX(RAIL_SLOPE_ORIGIN_HEIGHT, pointZ, transform.angle)
  const [localY, rotatedZ] = rotated
  const horizontal = rotateAroundY(pointX, rotatedZ, transform.yRotation)
  const [localX, localZ] = horizontal
  return [localX, localY, localZ]
}

const localRailPointOf = (shape: RailShape, point: RailPlanePoint): readonly [number, number, number] => {
  const [pointX, pointZ] = point
  const transform = RAIL_SLOPE_TRANSFORMS[shape]
  if (!transform) {
    return [pointX, RAIL_FLAT_HEIGHT, pointZ]
  }
  return raisedRailPointOf(point, transform)
}

const railVertexOf = (
  shape: RailShape,
  lx: number,
  y: number,
  lz: number,
  point: RailPlanePoint,
): SpecialVertex => {
  const [localX, localY, localZ] = localRailPointOf(shape, point)
  return [
    rounded(lx + localX),
    rounded(y + localY),
    rounded(lz + localZ),
  ]
}

/** Returns the four vertices of a vanilla rail model face. */
export const railVerticesOf = (
  shape: RailShape,
  lx: number,
  y: number,
  lz: number,
  direction: RailFaceDirection,
): readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex] => {
  const [first, second, third, fourth] = RAIL_PLANES[direction]
  return [
    railVertexOf(shape, lx, y, lz, first),
    railVertexOf(shape, lx, y, lz, second),
    railVertexOf(shape, lx, y, lz, third),
    railVertexOf(shape, lx, y, lz, fourth),
  ]
}
