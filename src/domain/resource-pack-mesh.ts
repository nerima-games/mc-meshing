import type {
  BlockStateProperties,
  BlockStateResolveOptions,
  ModelAxis,
  ModelElement,
  ModelElementRotation,
  ModelFace,
  ModelRotation,
  ResolvedBlockModel,
  ResourceModelFaceDirection,
  ResourceModelQuad,
  ResourceModelTransform,
  ResourceModelUv,
  ResourceModelVertex,
  ResourcePackAssets,
} from './resource-pack-types.js'
import { FACE_DIRECTIONS, type FaceDirection } from './faces.js'
import { resolveBlockModel, resolveBlockStateModels, resolveModelTexture } from './resource-pack-resolver.js'

const FIRST_INDEX = 0
const INDEX_STEP = 1
const SECOND_INDEX = 2
const THIRD_INDEX = 3

type Point = [number, number, number]
type Quad<Value> = readonly [Value, Value, Value, Value]
type CornerIndex = typeof FIRST_INDEX | typeof INDEX_STEP | typeof SECOND_INDEX | typeof THIRD_INDEX
type PointQuad = Quad<Point>
type ResourceModelUvQuad = Quad<ResourceModelUv>
type Bounds = readonly [number, number, number, number, number, number]

const NEGATIVE_UNIT = -1
const HALF_UNIT = 0.5
const MODEL_UNIT = INDEX_STEP
const MODEL_TEXTURE_SIZE = 16
const MODEL_SCALE = MODEL_UNIT / MODEL_TEXTURE_SIZE
const HALF_TURN_DEGREES = 180
const ROUNDING_SCALE = 100_000_000
const POINT_EPSILON = 0.0000001
const RESCALE_EPSILON = 0.000001
const DEFAULT_SHADE = true

const CORNER_INDEXES: readonly CornerIndex[] = [FIRST_INDEX, INDEX_STEP, SECOND_INDEX, THIRD_INDEX]
const QUARTER_TURN_INDEX: Readonly<Record<ModelRotation, CornerIndex>> = {
  0: FIRST_INDEX,
  180: SECOND_INDEX,
  270: THIRD_INDEX,
  90: INDEX_STEP,
}
const CORNER_ORDER_BY_TURN: readonly [Quad<CornerIndex>, Quad<CornerIndex>, Quad<CornerIndex>, Quad<CornerIndex>] = [
  [FIRST_INDEX, INDEX_STEP, SECOND_INDEX, THIRD_INDEX],
  [INDEX_STEP, SECOND_INDEX, THIRD_INDEX, FIRST_INDEX],
  [SECOND_INDEX, THIRD_INDEX, FIRST_INDEX, INDEX_STEP],
  [THIRD_INDEX, FIRST_INDEX, INDEX_STEP, SECOND_INDEX],
]

const pointOf = (x: number, y: number, z: number): Point => [x, y, z]

const rounded = (value: number): number => Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE

const faceVerticesFromBounds = (
  direction: FaceDirection,
  bounds: Bounds,
): PointQuad => {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds
  switch (direction) {
    case 'xPos':
      return [
        pointOf(maxX, minY, minZ),
        pointOf(maxX, maxY, minZ),
        pointOf(maxX, maxY, maxZ),
        pointOf(maxX, minY, maxZ),
      ]
    case 'xNeg':
      return [
        pointOf(minX, minY, maxZ),
        pointOf(minX, maxY, maxZ),
        pointOf(minX, maxY, minZ),
        pointOf(minX, minY, minZ),
      ]
    case 'yPos':
      return [
        pointOf(minX, maxY, minZ),
        pointOf(minX, maxY, maxZ),
        pointOf(maxX, maxY, maxZ),
        pointOf(maxX, maxY, minZ),
      ]
    case 'yNeg':
      return [
        pointOf(minX, minY, maxZ),
        pointOf(minX, minY, minZ),
        pointOf(maxX, minY, minZ),
        pointOf(maxX, minY, maxZ),
      ]
    case 'zPos':
      return [
        pointOf(maxX, minY, maxZ),
        pointOf(maxX, maxY, maxZ),
        pointOf(minX, maxY, maxZ),
        pointOf(minX, minY, maxZ),
      ]
    default:
      return [
        pointOf(minX, minY, minZ),
        pointOf(minX, maxY, minZ),
        pointOf(maxX, maxY, minZ),
        pointOf(maxX, minY, minZ),
      ]
  }
}

const faceVerticesOf = (direction: FaceDirection, from: readonly [number, number, number], to: readonly [number, number, number]): PointQuad =>
  faceVerticesFromBounds(
    direction,
    [
      from[FIRST_INDEX] * MODEL_SCALE,
      from[INDEX_STEP] * MODEL_SCALE,
      from[SECOND_INDEX] * MODEL_SCALE,
      to[FIRST_INDEX] * MODEL_SCALE,
      to[INDEX_STEP] * MODEL_SCALE,
      to[SECOND_INDEX] * MODEL_SCALE,
    ],
  )

const mapQuad = <Input, Output>(quad: Quad<Input>, map: (value: Input, index: CornerIndex) => Output): Quad<Output> => {
  const [first, second, third, fourth] = quad
  return [
    map(first, FIRST_INDEX),
    map(second, INDEX_STEP),
    map(third, SECOND_INDEX),
    map(fourth, THIRD_INDEX),
  ]
}

const rotateVector = (point: Point, axis: ModelAxis, degrees: number): Point => {
  const radians = (degrees * Math.PI) / HALF_TURN_DEGREES
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const [x, y, z] = point
  switch (axis) {
    case 'x':
      return pointOf(rounded(x), rounded(y * cosine - z * sine), rounded(y * sine + z * cosine))
    case 'y':
      return pointOf(rounded(x * cosine + z * sine), rounded(y), rounded(-x * sine + z * cosine))
    default:
      return pointOf(rounded(x * cosine - y * sine), rounded(x * sine + y * cosine), rounded(z))
  }
}

const rotateAround = (point: Point, origin: Point, axis: ModelAxis, degrees: number): Point => {
  const relative = pointOf(
    point[FIRST_INDEX] - origin[FIRST_INDEX],
    point[INDEX_STEP] - origin[INDEX_STEP],
    point[SECOND_INDEX] - origin[SECOND_INDEX],
  )
  const rotated = rotateVector(relative, axis, degrees)
  return pointOf(
    rounded(rotated[FIRST_INDEX] + origin[FIRST_INDEX]),
    rounded(rotated[INDEX_STEP] + origin[INDEX_STEP]),
    rounded(rotated[SECOND_INDEX] + origin[SECOND_INDEX]),
  )
}

const rescaleOf = (rescale: boolean | undefined, radians: number): number => {
  if (rescale !== true) {
    return MODEL_UNIT
  }
  return MODEL_UNIT / Math.max(Math.abs(Math.cos(radians)), RESCALE_EPSILON)
}

const scaledRelativeOf = (relative: Point, axis: ModelAxis, scale: number): Point => {
  switch (axis) {
    case 'x':
      return pointOf(relative[FIRST_INDEX], relative[INDEX_STEP] * scale, relative[SECOND_INDEX] * scale)
    case 'y':
      return pointOf(relative[FIRST_INDEX] * scale, relative[INDEX_STEP], relative[SECOND_INDEX] * scale)
    default:
      return pointOf(relative[FIRST_INDEX] * scale, relative[INDEX_STEP] * scale, relative[SECOND_INDEX])
  }
}

type ElementRotationStep = Readonly<{
  origin: Point
  axis: ModelAxis
  degrees: number
  rescale: boolean | undefined
}>

const rotateElementAround = (point: Point, step: ElementRotationStep): Point => {
  const { origin, axis, degrees, rescale } = step
  const relative = pointOf(
    point[FIRST_INDEX] - origin[FIRST_INDEX],
    point[INDEX_STEP] - origin[INDEX_STEP],
    point[SECOND_INDEX] - origin[SECOND_INDEX],
  )
  const radians = (degrees * Math.PI) / HALF_TURN_DEGREES
  const scaled = scaledRelativeOf(relative, axis, rescaleOf(rescale, radians))
  const rotated = rotateVector(scaled, axis, degrees)
  return pointOf(
    rounded(rotated[FIRST_INDEX] + origin[FIRST_INDEX]),
    rounded(rotated[INDEX_STEP] + origin[INDEX_STEP]),
    rounded(rotated[SECOND_INDEX] + origin[SECOND_INDEX]),
  )
}

const elementRotationOriginOf = (rotation: ModelElementRotation): Point => pointOf(
  rotation.origin[FIRST_INDEX] * MODEL_SCALE,
  rotation.origin[INDEX_STEP] * MODEL_SCALE,
  rotation.origin[SECOND_INDEX] * MODEL_SCALE,
)

const legacyElementRotationOf = (
  point: Point,
  origin: Point,
  rotation: ModelElementRotation,
): Point | undefined => {
  const { angle, axis, rescale } = rotation
  if (typeof axis === 'undefined' && typeof angle === 'undefined') {
    return
  }
  if (typeof axis === 'undefined' || typeof angle === 'undefined') {
    throw new RangeError('Element rotation axis and angle must be provided together')
  }
  return rotateElementAround(point, { axis, degrees: angle, origin, rescale })
}

const multiAxisElementRotationOf = (
  point: Point,
  origin: Point,
  rotation: ModelElementRotation,
): Point => {
  const { rescale, x, y, z } = rotation
  if (typeof x === 'undefined' && typeof y === 'undefined' && typeof z === 'undefined') {
    throw new RangeError('Element rotation must define axis/angle or x/y/z')
  }
  const xRotated = rotateElementAround(point, { axis: 'x', degrees: x ?? FIRST_INDEX, origin, rescale })
  const yRotated = rotateElementAround(xRotated, { axis: 'y', degrees: y ?? FIRST_INDEX, origin, rescale })
  return rotateElementAround(yRotated, { axis: 'z', degrees: z ?? FIRST_INDEX, origin, rescale })
}

const applyElementRotation = (point: Point, rotation: ModelElementRotation | undefined): Point => {
  if (typeof rotation === 'undefined') {
    return point
  }
  const origin = elementRotationOriginOf(rotation)
  const legacyRotation = legacyElementRotationOf(point, origin, rotation)
  if (typeof legacyRotation !== 'undefined') {
    return legacyRotation
  }
  return multiAxisElementRotationOf(point, origin, rotation)
}

const fullTransformOf = (transform: ResourceModelTransform): Required<ResourceModelTransform> => ({
  uvlock: transform.uvlock ?? false,
  x: transform.x ?? FIRST_INDEX,
  y: transform.y ?? FIRST_INDEX,
  z: transform.z ?? FIRST_INDEX,
})

const applyBlockRotation = (point: Point, transform: Required<ResourceModelTransform>): Point => {
  const center = pointOf(HALF_UNIT, HALF_UNIT, HALF_UNIT)
  const xRotated = rotateAround(point, center, 'x', transform.x)
  const yRotated = rotateAround(xRotated, center, 'y', transform.y)
  return rotateAround(yRotated, center, 'z', transform.z)
}

const directionNormals: Readonly<Record<FaceDirection, Point>> = {
  xNeg: pointOf(NEGATIVE_UNIT, FIRST_INDEX, FIRST_INDEX),
  xPos: pointOf(INDEX_STEP, FIRST_INDEX, FIRST_INDEX),
  yNeg: pointOf(FIRST_INDEX, NEGATIVE_UNIT, FIRST_INDEX),
  yPos: pointOf(FIRST_INDEX, INDEX_STEP, FIRST_INDEX),
  zNeg: pointOf(FIRST_INDEX, FIRST_INDEX, NEGATIVE_UNIT),
  zPos: pointOf(FIRST_INDEX, FIRST_INDEX, INDEX_STEP),
}

const resourceFaceDirectionOf: Readonly<Record<FaceDirection, ResourceModelFaceDirection>> = {
  xNeg: 'west',
  xPos: 'east',
  yNeg: 'down',
  yPos: 'up',
  zNeg: 'north',
  zPos: 'south',
}

const internalFaceDirectionOf: Readonly<Record<ResourceModelFaceDirection, FaceDirection>> = {
  down: 'yNeg',
  east: 'xPos',
  north: 'zNeg',
  south: 'zPos',
  up: 'yPos',
  west: 'xNeg',
}

type AxisNormalKey = '-1,0,0' | '0,-1,0' | '0,0,-1' | '0,0,1' | '0,1,0' | '1,0,0'

const directionByNormal: Readonly<Record<AxisNormalKey, FaceDirection>> = {
  '-1,0,0': 'xNeg',
  '0,-1,0': 'yNeg',
  '0,0,-1': 'zNeg',
  '0,0,1': 'zPos',
  '0,1,0': 'yPos',
  '1,0,0': 'xPos',
}

const isAxisNormalKey = (key: string): key is AxisNormalKey => Object.hasOwn(directionByNormal, key)

const directionOf = (normal: Point): FaceDirection => {
  const key = `${Math.round(normal[FIRST_INDEX])},${Math.round(normal[INDEX_STEP])},${Math.round(normal[SECOND_INDEX])}`
  if (!isAxisNormalKey(key)) {
    throw new RangeError(`Transformed face normal is not axis-aligned: ${key}`)
  }
  return directionByNormal[key]
}

const transformDirection = (direction: FaceDirection, transform: Required<ResourceModelTransform>): FaceDirection => {
  const xRotated = rotateVector(directionNormals[direction], 'x', transform.x)
  const yRotated = rotateVector(xRotated, 'y', transform.y)
  return directionOf(rotateVector(yRotated, 'z', transform.z))
}

const uvCoordinatesOf = (face: ModelFace): ResourceModelUvQuad => {
  const [u0, v0, u1, v1] = face.uv ?? [FIRST_INDEX, FIRST_INDEX, MODEL_TEXTURE_SIZE, MODEL_TEXTURE_SIZE]
  const corners: ResourceModelUvQuad = [
    [u0, v0],
    [u0, v1],
    [u1, v1],
    [u1, v0],
  ]
  const turns = QUARTER_TURN_INDEX[face.rotation ?? FIRST_INDEX]
  const [first, second, third, fourth] = CORNER_ORDER_BY_TURN[turns]
  return [
    corners[first],
    corners[second],
    corners[third],
    corners[fourth],
  ]
}

const samePoint = (left: Point, right: Point): boolean =>
  Math.abs(left[FIRST_INDEX] - right[FIRST_INDEX]) < POINT_EPSILON &&
  Math.abs(left[INDEX_STEP] - right[INDEX_STEP]) < POINT_EPSILON &&
  Math.abs(left[SECOND_INDEX] - right[SECOND_INDEX]) < POINT_EPSILON

const boundsOf = (points: PointQuad): Bounds => {
  const xs = points.map((point) => point[FIRST_INDEX])
  const ys = points.map((point) => point[INDEX_STEP])
  const zs = points.map((point) => point[SECOND_INDEX])
  return [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)]
}

const uvAt = (base: ResourceModelUvQuad, index: CornerIndex, targetIndex: CornerIndex | undefined): ResourceModelUv => {
  if (typeof targetIndex === 'undefined') {
    return base[index]
  }
  return base[targetIndex]
}

const uvForFace = (
  face: ModelFace,
  direction: FaceDirection,
  transformedVertices: PointQuad,
  transform: Required<ResourceModelTransform>,
): ResourceModelUvQuad => {
  const base = uvCoordinatesOf(face)
  if (!transform.uvlock) {
    return base
  }
  const [minX, minY, minZ, maxX, maxY, maxZ] = boundsOf(transformedVertices)
  const targetDirection = transformDirection(direction, transform)
  const targetVertices = faceVerticesFromBounds(targetDirection, [minX, minY, minZ, maxX, maxY, maxZ])
  return mapQuad(transformedVertices, (point, index) => {
    const targetIndex = CORNER_INDEXES.find((candidate) => samePoint(point, targetVertices[candidate]))
    return uvAt(base, index, targetIndex)
  })
}

const vectorBetween = (from: Point, to: Point): Point => pointOf(
  to[FIRST_INDEX] - from[FIRST_INDEX],
  to[INDEX_STEP] - from[INDEX_STEP],
  to[SECOND_INDEX] - from[SECOND_INDEX],
)

const crossProduct = (left: Point, right: Point): Point => pointOf(
  left[INDEX_STEP] * right[SECOND_INDEX] - left[SECOND_INDEX] * right[INDEX_STEP],
  left[SECOND_INDEX] * right[FIRST_INDEX] - left[FIRST_INDEX] * right[SECOND_INDEX],
  left[FIRST_INDEX] * right[INDEX_STEP] - left[INDEX_STEP] * right[FIRST_INDEX],
)

const normalOf = (vertices: PointQuad): ResourceModelVertex => {
  const normal = crossProduct(vectorBetween(vertices[FIRST_INDEX], vertices[INDEX_STEP]), vectorBetween(vertices[FIRST_INDEX], vertices[SECOND_INDEX]))
  const length = Math.hypot(normal[FIRST_INDEX], normal[INDEX_STEP], normal[SECOND_INDEX])
  if (!(length > POINT_EPSILON)) {
    throw new RangeError('Resource model face must have non-zero area')
  }
  return [
    rounded(normal[FIRST_INDEX] / length),
    rounded(normal[INDEX_STEP] / length),
    rounded(normal[SECOND_INDEX] / length),
  ]
}

type FaceMetadata = { cullface?: FaceDirection; tintIndex?: number }

const faceMetadataOf = (face: ModelFace, transform: Required<ResourceModelTransform>): FaceMetadata => {
  const metadata: FaceMetadata = {}
  if (typeof face.cullface !== 'undefined') {
    metadata.cullface = transformDirection(internalFaceDirectionOf[face.cullface], transform)
  }
  if (typeof face.tintindex !== 'undefined') {
    metadata.tintIndex = face.tintindex
  }
  return metadata
}

const shadeOf = (element: ModelElement): boolean => {
  if (typeof element.shade === 'undefined') {
    return DEFAULT_SHADE
  }
  return element.shade
}

const meshResolvedModel = (
  model: ResolvedBlockModel,
  transform: Required<ResourceModelTransform>,
): ReadonlyArray<ResourceModelQuad> =>
  model.elements.flatMap((element) =>
    FACE_DIRECTIONS.flatMap((direction) => {
      const face = element.faces[resourceFaceDirectionOf[direction]]
      if (typeof face === 'undefined') {
        return []
      }
      const localVertices = faceVerticesOf(direction, element.from, element.to)
      const transformedVertices = mapQuad(
        localVertices,
        (point) => applyBlockRotation(applyElementRotation(point, element.rotation), transform),
      )
      const quadBase = {
        ambientOcclusion: model.ambientOcclusion,
        direction: transformDirection(direction, transform),
        model: model.name,
        normal: normalOf(transformedVertices),
        shade: shadeOf(element),
        texture: resolveModelTexture(model, face.texture),
        uv: uvForFace(face, direction, transformedVertices, transform),
        vertices: transformedVertices,
      }
      return {
        ...quadBase,
        ...faceMetadataOf(face, transform),
      }
    }),
  )

/** Mesh all faces in a resolved block model into normalized chunk-local quads. */
export const meshBlockModel = (
  name: string,
  assets: ResourcePackAssets,
  transform: ResourceModelTransform = {},
): ReadonlyArray<ResourceModelQuad> => {
  const model = resolveBlockModel(name, assets)
  return meshResolvedModel(model, fullTransformOf(transform))
}

/** Resolve and mesh every model selected by a blockstate variant or multipart. */
export const meshBlockState = (
  name: string,
  properties: BlockStateProperties,
  assets: ResourcePackAssets,
  options?: BlockStateResolveOptions,
): ReadonlyArray<ResourceModelQuad> =>
  resolveBlockStateModels(name, properties, assets, options).flatMap((state) => {
    const model = resolveBlockModel(state.model, assets)
    return meshResolvedModel(model, fullTransformOf(state))
  })
