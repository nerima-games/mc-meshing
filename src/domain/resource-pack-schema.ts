/* oxlint-disable new-cap -- Effect Schema exposes capitalized factory functions, not constructors. */
/* oxlint-disable sort-keys -- Schema fields follow the Minecraft JSON vocabulary for reviewability. */
/* oxlint-disable no-magic-numbers -- These literals are Minecraft's JSON protocol values. */
import {
  RESOURCE_MODEL_FACE_DIRECTIONS,
  type BlockModel,
  type BlockStateCondition,
  type BlockStateDefinition,
  type BlockStateMultipart,
  type BlockStateVariant,
  type BlockStateVariantList,
  type ModelElement,
  type ModelElementRotation,
  type ModelFace,
  type ResourcePackAssets,
} from './resource-pack-types.js'
import { Schema } from 'effect'

const modelRotationSchema = Schema.Literal(0, 90, 180, 270)
const modelAxisSchema = Schema.Literal('x', 'y', 'z')
const faceDirectionSchema = Schema.Literal(...RESOURCE_MODEL_FACE_DIRECTIONS)
const finiteNumberSchema = Schema.Number.pipe(Schema.finite())
const modelElementAngleSchema = finiteNumberSchema
const positiveFiniteNumberSchema = finiteNumberSchema.pipe(Schema.greaterThan(0))
const numberTuple3Schema = Schema.Tuple(finiteNumberSchema, finiteNumberSchema, finiteNumberSchema)
const numberTuple4Schema = Schema.Tuple(
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
)

const modelFaceSchema: Schema.Schema<ModelFace> = Schema.Struct({
  texture: Schema.String,
  uv: Schema.optionalWith(numberTuple4Schema, { exact: true }),
  rotation: Schema.optionalWith(modelRotationSchema, { exact: true }),
  cullface: Schema.optionalWith(faceDirectionSchema, { exact: true }),
  tintindex: Schema.optionalWith(finiteNumberSchema, { exact: true }),
})

const modelFacesSchema: Schema.Schema<ModelElement['faces']> = Schema.Struct({
  down: Schema.optionalWith(modelFaceSchema, { exact: true }),
  up: Schema.optionalWith(modelFaceSchema, { exact: true }),
  north: Schema.optionalWith(modelFaceSchema, { exact: true }),
  south: Schema.optionalWith(modelFaceSchema, { exact: true }),
  west: Schema.optionalWith(modelFaceSchema, { exact: true }),
  east: Schema.optionalWith(modelFaceSchema, { exact: true }),
})

const modelElementRotationSchema: Schema.Schema<ModelElementRotation> = Schema.Struct({
  origin: numberTuple3Schema,
  axis: Schema.optionalWith(modelAxisSchema, { exact: true }),
  angle: Schema.optionalWith(modelElementAngleSchema, { exact: true }),
  x: Schema.optionalWith(modelElementAngleSchema, { exact: true }),
  y: Schema.optionalWith(modelElementAngleSchema, { exact: true }),
  z: Schema.optionalWith(modelElementAngleSchema, { exact: true }),
  rescale: Schema.optionalWith(Schema.Boolean, { exact: true }),
}).pipe(
  Schema.filter((rotation) => {
    const hasAxis = typeof rotation.axis !== 'undefined'
    const hasAngle = typeof rotation.angle !== 'undefined'
    const hasAxisRotation =
      typeof rotation.x !== 'undefined' ||
      typeof rotation.y !== 'undefined' ||
      typeof rotation.z !== 'undefined'
    return hasAxis === hasAngle && (hasAxis || hasAxisRotation)
  }),
)

const modelElementSchema: Schema.Schema<ModelElement> = Schema.Struct({
  from: numberTuple3Schema,
  to: numberTuple3Schema,
  rotation: Schema.optionalWith(modelElementRotationSchema, { exact: true }),
  shade: Schema.optionalWith(Schema.Boolean, { exact: true }),
  faces: modelFacesSchema,
})

const blockModelSchema: Schema.Schema<BlockModel> = Schema.Struct({
  parent: Schema.optionalWith(Schema.String, { exact: true }),
  ambientocclusion: Schema.optionalWith(Schema.Boolean, { exact: true }),
  textures: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), { exact: true }),
  elements: Schema.optionalWith(Schema.Array(modelElementSchema), { exact: true }),
})

const blockStateVariantSchema: Schema.Schema<BlockStateVariant> = Schema.Struct({
  model: Schema.String,
  x: Schema.optionalWith(modelRotationSchema, { exact: true }),
  y: Schema.optionalWith(modelRotationSchema, { exact: true }),
  z: Schema.optionalWith(modelRotationSchema, { exact: true }),
  uvlock: Schema.optionalWith(Schema.Boolean, { exact: true }),
  weight: Schema.optionalWith(positiveFiniteNumberSchema, { exact: true }),
})
const blockStateVariantListSchema: Schema.Schema<BlockStateVariantList> = Schema.NonEmptyArray(blockStateVariantSchema)

const blockStateConditionSchema: Schema.Schema<BlockStateCondition> = Schema.suspend(() =>
  Schema.Union(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    Schema.Struct({ OR: Schema.Array(blockStateConditionSchema) }),
    Schema.Struct({ AND: Schema.Array(blockStateConditionSchema) }),
  ),
)

const blockStateMultipartSchema: Schema.Schema<BlockStateMultipart> = Schema.Struct({
  when: Schema.optionalWith(blockStateConditionSchema, { exact: true }),
  apply: Schema.Union(blockStateVariantSchema, blockStateVariantListSchema),
})

const blockStateVariantsDefinitionSchema = Schema.Struct({
  variants: Schema.Record({
    key: Schema.String,
    value: Schema.Union(blockStateVariantSchema, blockStateVariantListSchema),
  }),
  multipart: Schema.optionalWith(Schema.Never, { exact: true }),
})

const blockStateMultipartDefinitionSchema = Schema.Struct({
  variants: Schema.optionalWith(Schema.Never, { exact: true }),
  multipart: Schema.Array(blockStateMultipartSchema),
})

const blockStateDefinitionSchema: Schema.Schema<BlockStateDefinition> = Schema.Union(
  blockStateVariantsDefinitionSchema,
  blockStateMultipartDefinitionSchema,
)

/** Effect Schema for the supported, loader-independent resource-pack JSON subset. */
export const ResourcePackAssetsSchema: Schema.Schema<ResourcePackAssets> = Schema.Struct({
  blockstates: Schema.Record({ key: Schema.String, value: blockStateDefinitionSchema }),
  models: Schema.Record({ key: Schema.String, value: blockModelSchema }),
})

const resourcePackAssetsJsonSchema = Schema.parseJson(ResourcePackAssetsSchema)

export type ResourcePackParseInput = 'object' | 'json'

/** Raised when an unknown value does not satisfy the resource-pack data contract. */
export class ResourcePackParseError extends Error {
  override readonly name = 'ResourcePackParseError'
  readonly input: ResourcePackParseInput

  constructor(input: ResourcePackParseInput, cause: unknown) {
    super(`Invalid resource-pack ${input} input: ${String(cause)}`, { cause })
    this.input = input
  }
}

/** Decode an unknown JSON-compatible value into the supported resource-pack types. */
export const parseResourcePackAssets = (value: unknown): ResourcePackAssets => {
  try {
    return Schema.decodeUnknownSync(ResourcePackAssetsSchema, { onExcessProperty: 'error' })(value)
  } catch (cause) {
    throw new ResourcePackParseError('object', cause)
  }
}

/** Parse and decode a JSON document into the supported resource-pack types. */
export const parseResourcePackAssetsJson = (value: string): ResourcePackAssets => {
  try {
    return Schema.decodeUnknownSync(resourcePackAssetsJsonSchema, { onExcessProperty: 'error' })(value)
  } catch (cause) {
    throw new ResourcePackParseError('json', cause)
  }
}
