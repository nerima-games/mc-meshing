import type {
  BlockModel,
  BlockStateAndCondition,
  BlockStateCondition,
  BlockStateDefinition,
  BlockStateMultipart,
  BlockStateOrCondition,
  BlockStateProperties,
  BlockStateResolveOptions,
  BlockStateVariant,
  BlockStateVariantList,
  ModelElement,
  ModelName,
  ResolvedBlockModel,
  ResolvedBlockStateModel,
  ResourceName,
  ResourcePackAssets,
  TextureName,
} from './resource-pack-types.js'
import { Brand, Option, Result } from 'effect'

export type ResourceAssetKind = 'blockstate' | 'model'


export type ResourcePackResolutionFailureCode =
  | 'invalid-resource-name'
  | 'invalid-seed'
  | 'invalid-texture-reference'
  | 'missing-blockstate'
  | 'empty-variant-list'
  | 'invalid-variant-weight'
  | 'no-matching-variant'
  | 'missing-model'
  | 'invalid-blockstate-definition'
  | 'block-model-cycle'
  | 'texture-reference-cycle'
  | 'missing-texture-variable'

export type ResourcePackResolutionFailure = {
  readonly _tag: 'ResourcePackResolutionFailure'
  readonly code: ResourcePackResolutionFailureCode
  readonly message: string
}

const resolutionFailure = (
  code: ResourcePackResolutionFailureCode,
  message: string,
): ResourcePackResolutionFailure => ({
  _tag: 'ResourcePackResolutionFailure',
  code,
  message,
})

const failResolution = (
  code: ResourcePackResolutionFailureCode,
  message: string,
): Result.Result<never, ResourcePackResolutionFailure> =>
  Result.fail(resolutionFailure(code, message))

const JSON_SUFFIX = '.json'
const JSON_SUFFIX_LENGTH = JSON_SUFFIX.length
const MODEL_DIRECTORY = 'models/'
const BLOCKSTATE_DIRECTORY = 'blockstates/'
const TEXTURE_DIRECTORY = 'textures/'
const DEFAULT_NAMESPACE = 'minecraft:'
const NAMESPACE_SEPARATOR = ':'
const FIRST_INDEX = 0
const EMPTY_INDEX = -1
const INDEX_STEP = 1
const DEFAULT_ROTATION = 0
const DEFAULT_VARIANT_WEIGHT = 1
const DEFAULT_SEED = 0
const DEFAULT_AMBIENT_OCCLUSION = true
const RANDOM_SEED_MIX_A = 0x9e3779b9
const RANDOM_SEED_MIX_B = 0x85ebca6b
const RANDOM_SHIFT = 13
const UNIT_INTERVAL_SIZE = 0x100000000

const isCanonicalName = (name: string): boolean => {
  const separator = name.indexOf(NAMESPACE_SEPARATOR)
  return name === name.trim() && separator > FIRST_INDEX && separator < name.length - INDEX_STEP
}

const resourceNameBrand = Brand.nominal<ResourceName>()
const modelNameBrand = Brand.nominal<ModelName>()
const textureNameBrand = Brand.nominal<TextureName>()

const resourceNameOf = (name: string): Result.Result<ResourceName, ResourcePackResolutionFailure> => {
  if (!isCanonicalName(name)) {
    return failResolution('invalid-resource-name', 'Expected a normalized resource name')
  }
  return Result.succeed(resourceNameBrand(name))
}

const modelNameOf = (name: string): Result.Result<ModelName, ResourcePackResolutionFailure> => {
  if (!isCanonicalName(name)) {
    return failResolution('invalid-resource-name', 'Expected a normalized model name')
  }
  return Result.succeed(modelNameBrand(name))
}

const textureNameOf = (name: string): Result.Result<TextureName, ResourcePackResolutionFailure> => {
  if (!isCanonicalName(name)) {
    return failResolution('invalid-texture-reference', 'Expected a normalized texture name')
  }
  return Result.succeed(textureNameBrand(name))
}

const stripJsonSuffix = (name: string): string => {
  if (!name.endsWith(JSON_SUFFIX)) {
    return name
  }
  return name.slice(FIRST_INDEX, -JSON_SUFFIX_LENGTH)
}

const directoryOf = (kind: ResourceAssetKind): string => {
  if (kind === 'model') {
    return MODEL_DIRECTORY
  }
  return BLOCKSTATE_DIRECTORY
}

const pathWithoutDirectory = (path: string, directory: string): string => {
  if (!path.startsWith(directory)) {
    return path
  }
  return path.slice(directory.length)
}

const namespacedPathOf = (path: string): string => {
  if (path.includes(NAMESPACE_SEPARATOR)) {
    return path
  }
  return `${DEFAULT_NAMESPACE}${path}`
}

/** Normalize a resource-pack path to a namespaced logical asset name. */
export function normalizeResourceName(
  name: string,
  kind: 'blockstate',
): Result.Result<ResourceName, ResourcePackResolutionFailure>
export function normalizeResourceName(
  name: string,
  kind: 'model',
): Result.Result<ModelName, ResourcePackResolutionFailure>
export function normalizeResourceName(
  name: string,
  kind: ResourceAssetKind,
): Result.Result<ResourceName | ModelName, ResourcePackResolutionFailure>
export function normalizeResourceName(
  name: string,
  kind: ResourceAssetKind,
): Result.Result<ResourceName | ModelName, ResourcePackResolutionFailure> {
  const trimmed = name.trim()
  if (trimmed.length === FIRST_INDEX) {
    return failResolution('invalid-resource-name', 'Resource names must not be empty')
  }
  const path = pathWithoutDirectory(stripJsonSuffix(trimmed), directoryOf(kind))
  if (path.length === FIRST_INDEX) {
    return failResolution('invalid-resource-name', 'Resource names must contain a path')
  }
  const canonicalName = namespacedPathOf(path)
  if (kind === 'model') {
    return modelNameOf(canonicalName)
  }
  return resourceNameOf(canonicalName)
}

const normalizeTextureName = (name: string): Result.Result<TextureName, ResourcePackResolutionFailure> => {
  const trimmed = name.trim()
  if (trimmed.length === FIRST_INDEX) {
    return failResolution('invalid-texture-reference', 'Texture references must not be empty')
  }
  const path = pathWithoutDirectory(stripJsonSuffix(trimmed), TEXTURE_DIRECTORY)
  return textureNameOf(namespacedPathOf(path))
}

const bareNameOf = (canonical: ResourceName | ModelName): string => {
  const separator = canonical.indexOf(NAMESPACE_SEPARATOR)
  return canonical.slice(separator + INDEX_STEP)
}

const findAsset = <Asset>(
  assets: Readonly<Record<string, Asset>>,
  canonical: ResourceName | ModelName,
): Result.Result<Option.Option<Asset>, ResourcePackResolutionFailure> => {
  const candidates = [canonical, bareNameOf(canonical)]
  for (const candidate of candidates) {
    const asset = assets[candidate]
    if (typeof asset !== 'undefined') {
      return Result.succeed(Option.some(asset))
    }
  }
  return Result.succeed(Option.none())
}

const blockStateDefinitionOf = (
  assets: ResourcePackAssets,
  name: ResourceName,
): Result.Result<BlockStateDefinition, ResourcePackResolutionFailure> =>
  Result.flatMap(findAsset(assets.blockstates, name), (definition) => {
    if (Option.isNone(definition)) {
      return failResolution('missing-blockstate', `Missing blockstate asset: ${name}`)
    }
    return Result.succeed(definition.value)
  })

const propertyValueMatches = (properties: BlockStateProperties, key: string, expected: string): boolean => {
  const actual = properties[key]
  if (typeof actual === 'undefined') {
    return false
  }
  return expected.split('|').includes(actual)
}

const variantKeyMatches = (key: string, properties: BlockStateProperties): boolean =>
  key.split(',').every((entry) => {
    const separator = entry.indexOf('=')
    if (separator <= EMPTY_INDEX) {
      return false
    }
    const property = entry.slice(FIRST_INDEX, separator).trim()
    const expected = entry.slice(separator + INDEX_STEP).trim()
    return propertyValueMatches(properties, property, expected)
  })

const isOrCondition = (condition: BlockStateCondition): condition is BlockStateOrCondition =>
  Object.entries(condition).some(([property, value]) => property === 'OR' && Array.isArray(value))

const isAndCondition = (condition: BlockStateCondition): condition is BlockStateAndCondition =>
  Object.entries(condition).some(([property, value]) => property === 'AND' && Array.isArray(value))

const conditionMatches = (condition: BlockStateCondition, properties: BlockStateProperties): boolean => {
  if (isOrCondition(condition)) {
    return condition.OR.some((child) => conditionMatches(child, properties))
  }
  if (isAndCondition(condition)) {
    return condition.AND.every((child) => conditionMatches(child, properties))
  }
  return Object.entries(condition).every(([property, expected]) => propertyValueMatches(properties, property, expected))
}

const isVariantList = (
  variant: BlockStateVariant | BlockStateVariantList,
): variant is BlockStateVariantList => Array.isArray(variant)

const variantListOf = (
  variant: BlockStateVariant | BlockStateVariantList,
): Result.Result<BlockStateVariantList, ResourcePackResolutionFailure> => {
  if (isVariantList(variant)) {
    const [first, ...rest] = variant
    if (typeof first === 'undefined') {
      return failResolution('empty-variant-list', 'A blockstate variant list must not be empty')
    }
    return Result.succeed([first, ...rest])
  }
  return Result.succeed([variant])
}

const variantWeightOf = (variant: BlockStateVariant): Result.Result<number, ResourcePackResolutionFailure> => {
  const weight = variant.weight ?? DEFAULT_VARIANT_WEIGHT
  if (!Number.isFinite(weight) || weight <= FIRST_INDEX) {
    return failResolution(
      'invalid-variant-weight',
      `Blockstate variant weight must be positive and finite, received ${weight}`,
    )
  }
  return Result.succeed(weight)
}

const randomUnitOf = (seed: number): number => {
  let value = Math.trunc(seed) | FIRST_INDEX
  value = Math.imul(value ^ RANDOM_SEED_MIX_A, RANDOM_SEED_MIX_B)
  value ^= value >>> RANDOM_SHIFT
  return (value >>> FIRST_INDEX) / UNIT_INTERVAL_SIZE
}

const weightedVariantOf = (
  variants: BlockStateVariantList,
  seed: number,
): Result.Result<BlockStateVariant, ResourcePackResolutionFailure> => {
  const [first, ...rest] = variants
  const firstWeight = variantWeightOf(first)
  if (Result.isFailure(firstWeight)) {
    return Result.fail(firstWeight.failure)
  }
  let total = firstWeight.success
  const weighted: Array<{ readonly variant: BlockStateVariant; readonly weight: number }> = [
    { variant: first, weight: firstWeight.success },
  ]
  for (const variant of rest) {
    const weight = variantWeightOf(variant)
    if (Result.isFailure(weight)) {
      return Result.fail(weight.failure)
    }
    total += weight.success
    weighted.push({ variant, weight: weight.success })
  }
  if (!Number.isFinite(total)) {
    return failResolution('invalid-variant-weight', `Blockstate variant weights overflowed: ${total}`)
  }
  let cursor = randomUnitOf(seed) * total
  let selected = first
  for (const item of weighted) {
    cursor -= item.weight
    if (cursor < FIRST_INDEX) {
      selected = item.variant
      break
    }
  }
  return Result.succeed(selected)
}

const chooseVariant = (variants: BlockStateVariantList, seed: number): Result.Result<BlockStateVariant, ResourcePackResolutionFailure> =>
  weightedVariantOf(variants, seed)

const resolvedVariantOf = (
  variant: BlockStateVariant,
): Result.Result<ResolvedBlockStateModel, ResourcePackResolutionFailure> =>
  Result.map(normalizeResourceName(variant.model, 'model'), (model) => ({
    model,
    uvlock: variant.uvlock ?? false,
    x: variant.x ?? DEFAULT_ROTATION,
    y: variant.y ?? DEFAULT_ROTATION,
    z: variant.z ?? DEFAULT_ROTATION,
  }))

const resolvedVariantsOf = (
  variant: BlockStateVariant | BlockStateVariantList,
  seed: number,
): Result.Result<ReadonlyArray<ResolvedBlockStateModel>, ResourcePackResolutionFailure> =>
  Result.flatMap(variantListOf(variant), (variants) =>
    Result.flatMap(chooseVariant(variants, seed), (chosen) =>
      Result.map(resolvedVariantOf(chosen), (resolved) => [resolved]),
    ),
  )

const matchingVariantOf = (
  variants: Readonly<Record<string, BlockStateVariant | BlockStateVariantList>>,
  properties: BlockStateProperties,
): Result.Result<BlockStateVariant | BlockStateVariantList, ResourcePackResolutionFailure> => {
  const specific = Object.entries(variants).find(([key]) => key.length > FIRST_INDEX && variantKeyMatches(key, properties))
  if (typeof specific !== 'undefined') {
    return Result.succeed(specific[INDEX_STEP])
  }
  const fallback = variants['']
  if (typeof fallback === 'undefined') {
    return failResolution('no-matching-variant', 'No blockstate variant matches the supplied properties')
  }
  return Result.succeed(fallback)
}

const multipartPartMatches = (part: BlockStateMultipart, properties: BlockStateProperties): boolean => {
  if (typeof part.when === 'undefined') {
    return true
  }
  return conditionMatches(part.when, properties)
}

const resolvedMultipartOf = (
  parts: ReadonlyArray<BlockStateMultipart>,
  properties: BlockStateProperties,
  seed: number,
): Result.Result<ReadonlyArray<ResolvedBlockStateModel>, ResourcePackResolutionFailure> => {
  const models: Array<ResolvedBlockStateModel> = []
  for (const [index, part] of parts.entries()) {
    if (!multipartPartMatches(part, properties)) {
      continue
    }
    const resolved = resolvedVariantsOf(part.apply, seed + index)
    if (Result.isFailure(resolved)) {
      return Result.fail(resolved.failure)
    }
    models.push(...resolved.success)
  }
  return Result.succeed(models)
}

/** Resolve variants and multipart applications without reading the filesystem. */
export const resolveBlockStateModels = (
  name: ResourceName,
  properties: BlockStateProperties,
  assets: ResourcePackAssets,
  options?: BlockStateResolveOptions,
): Result.Result<ReadonlyArray<ResolvedBlockStateModel>, ResourcePackResolutionFailure> => {
  const seed = options?.seed ?? DEFAULT_SEED
  if (!Number.isFinite(seed)) {
    return failResolution('invalid-seed', `Blockstate resolver seed must be finite, received ${seed}`)
  }
  return Result.flatMap(blockStateDefinitionOf(assets, name), (definition) => {
    if (typeof definition.variants !== 'undefined') {
      return Result.flatMap(matchingVariantOf(definition.variants, properties), (variant) =>
        resolvedVariantsOf(variant, seed),
      )
    }
    if (typeof definition.multipart !== 'undefined') {
      return resolvedMultipartOf(definition.multipart, properties, seed)
    }
    return failResolution(
      'invalid-blockstate-definition',
      'A blockstate asset must define variants or multipart',
    )
  })
}

const modelOf = (
  assets: ResourcePackAssets,
  name: ModelName,
): Result.Result<Option.Option<BlockModel>, ResourcePackResolutionFailure> =>
  findAsset(assets.models, name)

const emptyBuiltinModelOf = (name: ModelName): ResolvedBlockModel => ({
  ambientOcclusion: DEFAULT_AMBIENT_OCCLUSION,
  elements: [],
  name,
  textures: {},
})

const missingModelOf = (name: ModelName): Result.Result<ResolvedBlockModel, ResourcePackResolutionFailure> => {
  if (name.startsWith('minecraft:builtin/')) {
    return Result.succeed(emptyBuiltinModelOf(name))
  }
  return failResolution('missing-model', `Missing model asset: ${name}`)
}

const parentModelOf = (
  model: BlockModel,
  assets: ResourcePackAssets,
  resolving: ReadonlySet<ModelName>,
  resolve: (
    name: ModelName,
    assets: ResourcePackAssets,
    resolving: ReadonlySet<ModelName>,
  ) => Result.Result<ResolvedBlockModel, ResourcePackResolutionFailure>,
): Result.Result<Option.Option<ResolvedBlockModel>, ResourcePackResolutionFailure> => {
  if (typeof model.parent === 'undefined') {
    return Result.succeed(Option.none())
  }
  return Result.flatMap(normalizeResourceName(model.parent, 'model'), (parentName) =>
    Result.map(resolve(parentName, assets, resolving), Option.some),
  )
}

const texturesOf = (
  model: BlockModel,
  parent: Option.Option<ResolvedBlockModel>,
): Readonly<Record<string, string>> => ({
  ...(Option.isSome(parent) ? parent.value.textures : {}),
  ...(model.textures ?? {}),
})

const elementsOf = (
  model: BlockModel,
  parent: Option.Option<ResolvedBlockModel>,
): ReadonlyArray<ModelElement> => {
  if (typeof model.elements !== 'undefined') {
    return model.elements
  }
  if (Option.isNone(parent)) {
    return []
  }
  return parent.value.elements
}

const ambientOcclusionOf = (model: BlockModel, parent: Option.Option<ResolvedBlockModel>): boolean => {
  if (typeof model.ambientocclusion !== 'undefined') {
    return model.ambientocclusion
  }
  if (Option.isNone(parent)) {
    return true
  }
  return parent.value.ambientOcclusion
}

const resolvedModelOf = (
  name: ModelName,
  model: BlockModel,
  parent: Option.Option<ResolvedBlockModel>,
): ResolvedBlockModel => {
  const textures = texturesOf(model, parent)
  const elements = elementsOf(model, parent)
  return {
    ambientOcclusion: ambientOcclusionOf(model, parent),
    elements,
    name,
    textures,
  }
}

const resolveBlockModelInternal = (
  name: ModelName,
  assets: ResourcePackAssets,
  resolving: ReadonlySet<ModelName>,
): Result.Result<ResolvedBlockModel, ResourcePackResolutionFailure> => {
  if (resolving.has(name)) {
    return failResolution('block-model-cycle', `Block model parent cycle: ${name}`)
  }
  return Result.flatMap(modelOf(assets, name), (model) => {
    if (Option.isNone(model)) {
      return missingModelOf(name)
    }
    const nextResolving = new Set([...resolving, name])
    return Result.flatMap(
      parentModelOf(model.value, assets, nextResolving, resolveBlockModelInternal),
      (parent) => Result.succeed(resolvedModelOf(name, model.value, parent)),
    )
  })
}

/** Resolve model inheritance and merge inherited textures/elements. */
export const resolveBlockModel = (
  name: ModelName,
  assets: ResourcePackAssets,
): Result.Result<ResolvedBlockModel, ResourcePackResolutionFailure> =>
  resolveBlockModelInternal(name, assets, new Set<ModelName>())

const textureValueOf = (
  model: ResolvedBlockModel,
  key: string,
  seen: Set<string>,
): Result.Result<string, ResourcePackResolutionFailure> => {
  if (seen.has(key)) {
    return failResolution('texture-reference-cycle', `Texture reference cycle: ${key}`)
  }
  seen.add(key)
  const value = model.textures[key]
  if (typeof value === 'undefined') {
    return failResolution('missing-texture-variable', `Missing texture variable: ${key}`)
  }
  return Result.succeed(value)
}

/** Resolve a texture key such as `#side` to its namespaced texture asset. */
export const resolveModelTexture = (
  model: ResolvedBlockModel,
  reference: string,
): Result.Result<TextureName, ResourcePackResolutionFailure> => {
  let current = reference
  const seen = new Set<string>()
  while (current.startsWith('#')) {
    const next = textureValueOf(model, current.slice(INDEX_STEP), seen)
    if (Result.isFailure(next)) {
      return Result.fail(next.failure)
    }
    current = next.success
  }
  return normalizeTextureName(current)
}
