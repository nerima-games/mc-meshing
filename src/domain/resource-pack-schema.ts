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
import { Result, Schema, SchemaIssue, SchemaParser } from 'effect'

type ResourcePackSchema<Value> = Schema.Schema<Value> & Schema.ConstraintDecoder<Value, never>

const modelRotationSchema = Schema.Literals([0, 90, 180, 270])
const modelAxisSchema = Schema.Literals(['x', 'y', 'z'])
const faceDirectionSchema = Schema.Literals(RESOURCE_MODEL_FACE_DIRECTIONS)
const finiteNumberSchema = Schema.Finite
const modelElementAngleSchema = finiteNumberSchema
const positiveFiniteNumberSchema = finiteNumberSchema.check(Schema.isGreaterThan(0))
const numberTuple3Schema = Schema.Tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])
const numberTuple4Schema = Schema.Tuple([
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
])

const modelFaceSchema: ResourcePackSchema<ModelFace> = Schema.Struct({
  texture: Schema.String,
  uv: Schema.optionalKey(numberTuple4Schema),
  rotation: Schema.optionalKey(modelRotationSchema),
  cullface: Schema.optionalKey(faceDirectionSchema),
  tintindex: Schema.optionalKey(finiteNumberSchema),
})

const modelFacesSchema: ResourcePackSchema<ModelElement['faces']> = Schema.Struct({
  down: Schema.optionalKey(modelFaceSchema),
  up: Schema.optionalKey(modelFaceSchema),
  north: Schema.optionalKey(modelFaceSchema),
  south: Schema.optionalKey(modelFaceSchema),
  west: Schema.optionalKey(modelFaceSchema),
  east: Schema.optionalKey(modelFaceSchema),
})

const modelElementRotationSchema: ResourcePackSchema<ModelElementRotation> = Schema.Struct({
  origin: numberTuple3Schema,
  axis: Schema.optionalKey(modelAxisSchema),
  angle: Schema.optionalKey(modelElementAngleSchema),
  x: Schema.optionalKey(modelElementAngleSchema),
  y: Schema.optionalKey(modelElementAngleSchema),
  z: Schema.optionalKey(modelElementAngleSchema),
  rescale: Schema.optionalKey(Schema.Boolean),
}).pipe(
  Schema.check(Schema.makeFilter((rotation: ModelElementRotation) => {
    const hasAxis = typeof rotation.axis !== 'undefined'
    const hasAngle = typeof rotation.angle !== 'undefined'
    const hasAxisRotation =
      typeof rotation.x !== 'undefined' ||
      typeof rotation.y !== 'undefined' ||
      typeof rotation.z !== 'undefined'
    return hasAxis === hasAngle && (hasAxis || hasAxisRotation)
  })),
)

const modelElementSchema: ResourcePackSchema<ModelElement> = Schema.Struct({
  from: numberTuple3Schema,
  to: numberTuple3Schema,
  rotation: Schema.optionalKey(modelElementRotationSchema),
  shade: Schema.optionalKey(Schema.Boolean),
  faces: modelFacesSchema,
})

const blockModelSchema: ResourcePackSchema<BlockModel> = Schema.Struct({
  parent: Schema.optionalKey(Schema.String),
  ambientocclusion: Schema.optionalKey(Schema.Boolean),
  textures: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  elements: Schema.optionalKey(Schema.Array(modelElementSchema)),
})

const blockStateVariantSchema: ResourcePackSchema<BlockStateVariant> = Schema.Struct({
  model: Schema.String,
  x: Schema.optionalKey(modelRotationSchema),
  y: Schema.optionalKey(modelRotationSchema),
  z: Schema.optionalKey(modelRotationSchema),
  uvlock: Schema.optionalKey(Schema.Boolean),
  weight: Schema.optionalKey(positiveFiniteNumberSchema),
})
const blockStateVariantListSchema: ResourcePackSchema<BlockStateVariantList> = Schema.NonEmptyArray(blockStateVariantSchema)

const blockStateConditionSchema: ResourcePackSchema<BlockStateCondition> = Schema.suspend(() =>
  Schema.Union([
    Schema.Record(Schema.String, Schema.String),
    Schema.Struct({ OR: Schema.Array(blockStateConditionSchema) }),
    Schema.Struct({ AND: Schema.Array(blockStateConditionSchema) }),
  ]),
)

const blockStateMultipartSchema: ResourcePackSchema<BlockStateMultipart> = Schema.Struct({
  when: Schema.optionalKey(blockStateConditionSchema),
  apply: Schema.Union([blockStateVariantSchema, blockStateVariantListSchema]),
})

const blockStateVariantsDefinitionSchema = Schema.Struct({
  variants: Schema.Record(Schema.String, Schema.Union([blockStateVariantSchema, blockStateVariantListSchema])),
  multipart: Schema.optionalKey(Schema.Never),
})

const blockStateMultipartDefinitionSchema = Schema.Struct({
  variants: Schema.optionalKey(Schema.Never),
  multipart: Schema.Array(blockStateMultipartSchema),
})

const blockStateDefinitionSchema: ResourcePackSchema<BlockStateDefinition> = Schema.Union([
  blockStateVariantsDefinitionSchema,
  blockStateMultipartDefinitionSchema,
])

/** Effect Schema for the supported, loader-independent resource-pack JSON subset. */
export const ResourcePackAssetsSchema: ResourcePackSchema<ResourcePackAssets> = Schema.Struct({
  blockstates: Schema.Record(Schema.String, blockStateDefinitionSchema),
  models: Schema.Record(Schema.String, blockModelSchema),
})

const resourcePackAssetsJsonSchema = Schema.fromJsonString(ResourcePackAssetsSchema)

export type ResourcePackParseInput = 'object' | 'json'


export type ResourcePackParseFailure = {
  readonly _tag: 'ResourcePackParseFailure'
  readonly input: ResourcePackParseInput
  readonly issue: SchemaIssue.Issue
  readonly message: string
}

const parseFailureOf = (input: ResourcePackParseInput, issue: SchemaIssue.Issue): ResourcePackParseFailure => ({
  _tag: 'ResourcePackParseFailure',
  input,
  issue,
  message: `Invalid resource-pack ${input} input: ${SchemaIssue.makeFormatterDefault()(issue)}`,
})

/** Decode an unknown JSON-compatible value into the supported resource-pack types. */
export const parseResourcePackAssets = (value: unknown): Result.Result<ResourcePackAssets, ResourcePackParseFailure> =>
  Result.mapError(
    SchemaParser.decodeUnknownResult(ResourcePackAssetsSchema, { onExcessProperty: 'error' })(value),
    (issue) => parseFailureOf('object', issue),
  )

/** Parse and decode a JSON document into the supported resource-pack types. */
export const parseResourcePackAssetsJson = (value: string): Result.Result<ResourcePackAssets, ResourcePackParseFailure> =>
  Result.mapError(
    SchemaParser.decodeUnknownResult(resourcePackAssetsJsonSchema, { onExcessProperty: 'error' })(value),
    (issue) => parseFailureOf('json', issue),
  )
