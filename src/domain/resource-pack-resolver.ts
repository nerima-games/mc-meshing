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
  ResolvedBlockModel,
  ResolvedBlockStateModel,
  ResourcePackAssets,
} from './resource-pack-types.js'

export type ResourceAssetKind = 'blockstate' | 'model'

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
export const normalizeResourceName = (name: string, kind: ResourceAssetKind): string => {
  const trimmed = name.trim()
  if (trimmed.length === FIRST_INDEX) {
    throw new RangeError('Resource names must not be empty')
  }
  const path = pathWithoutDirectory(stripJsonSuffix(trimmed), directoryOf(kind))
  if (path.length === FIRST_INDEX) {
    throw new RangeError('Resource names must contain a path')
  }
  return namespacedPathOf(path)
}

const normalizeTextureName = (name: string): string => {
  const trimmed = name.trim()
  if (trimmed.length === FIRST_INDEX) {
    throw new RangeError('Texture references must not be empty')
  }
  const path = pathWithoutDirectory(stripJsonSuffix(trimmed), TEXTURE_DIRECTORY)
  return namespacedPathOf(path)
}

const bareNameOf = (canonical: string): string => {
  const separator = canonical.indexOf(NAMESPACE_SEPARATOR)
  return canonical.slice(separator + INDEX_STEP)
}

const findAsset = <Asset>(
  assets: Readonly<Record<string, Asset>>,
  name: string,
  kind: ResourceAssetKind,
): Asset | undefined => {
  const canonical = normalizeResourceName(name, kind)
  const candidates = [canonical, bareNameOf(canonical)]
  for (const candidate of candidates) {
    const asset = assets[candidate]
    if (typeof asset !== 'undefined') {
      return asset
    }
  }
  return
}

const blockStateDefinitionOf = (assets: ResourcePackAssets, name: string): BlockStateDefinition => {
  const definition = findAsset(assets.blockstates, name, 'blockstate')
  if (typeof definition === 'undefined') {
    throw new Error(`Missing blockstate asset: ${normalizeResourceName(name, 'blockstate')}`)
  }
  return definition
}

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

const variantListOf = (variant: BlockStateVariant | BlockStateVariantList): BlockStateVariantList => {
  if (isVariantList(variant)) {
    const [first, ...rest] = variant
    if (typeof first === 'undefined') {
      throw new RangeError('A blockstate variant list must not be empty')
    }
    return [first, ...rest]
  }
  return [variant]
}

const variantWeightOf = (variant: BlockStateVariant): number => {
  const weight = variant.weight ?? DEFAULT_VARIANT_WEIGHT
  if (!Number.isFinite(weight) || weight <= FIRST_INDEX) {
    throw new RangeError(`Blockstate variant weight must be positive and finite, received ${weight}`)
  }
  return weight
}

const randomUnitOf = (seed: number): number => {
  let value = Math.trunc(seed) | FIRST_INDEX
  value = Math.imul(value ^ RANDOM_SEED_MIX_A, RANDOM_SEED_MIX_B)
  value ^= value >>> RANDOM_SHIFT
  return (value >>> FIRST_INDEX) / UNIT_INTERVAL_SIZE
}

const weightedVariantOf = (variants: BlockStateVariantList, seed: number): BlockStateVariant => {
  const total = variants.reduce((sum, variant) => sum + variantWeightOf(variant), FIRST_INDEX)
  let cursor = randomUnitOf(seed) * total
  let selected = variants[FIRST_INDEX]
  for (const variant of variants) {
    cursor -= variantWeightOf(variant)
    if (cursor < FIRST_INDEX) {
      selected = variant
      break
    }
  }
  return selected
}

const chooseVariant = (variants: BlockStateVariantList, seed: number): BlockStateVariant =>
  weightedVariantOf(variants, seed)

const resolvedVariantOf = (variant: BlockStateVariant): ResolvedBlockStateModel => ({
  model: normalizeResourceName(variant.model, 'model'),
  uvlock: variant.uvlock ?? false,
  x: variant.x ?? DEFAULT_ROTATION,
  y: variant.y ?? DEFAULT_ROTATION,
  z: variant.z ?? DEFAULT_ROTATION,
})

const resolvedVariantsOf = (
  variant: BlockStateVariant | BlockStateVariantList,
  seed: number,
): ReadonlyArray<ResolvedBlockStateModel> => [resolvedVariantOf(chooseVariant(variantListOf(variant), seed))]

const matchingVariantOf = (
  variants: Readonly<Record<string, BlockStateVariant | BlockStateVariantList>>,
  properties: BlockStateProperties,
): BlockStateVariant | BlockStateVariantList => {
  const specific = Object.entries(variants).find(([key]) => key.length > FIRST_INDEX && variantKeyMatches(key, properties))
  if (typeof specific !== 'undefined') {
    return specific[INDEX_STEP]
  }
  const fallback = variants['']
  if (typeof fallback === 'undefined') {
    throw new Error('No blockstate variant matches the supplied properties')
  }
  return fallback
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
): ReadonlyArray<ResolvedBlockStateModel> =>
  parts.flatMap((part, index) => {
    if (!multipartPartMatches(part, properties)) {
      return []
    }
    return resolvedVariantsOf(part.apply, seed + index)
  })

/** Resolve variants and multipart applications without reading the filesystem. */
export const resolveBlockStateModels = (
  name: string,
  properties: BlockStateProperties,
  assets: ResourcePackAssets,
  options?: BlockStateResolveOptions,
): ReadonlyArray<ResolvedBlockStateModel> => {
  const definition = blockStateDefinitionOf(assets, name)
  const seed = options?.seed ?? DEFAULT_SEED
  if (typeof definition.variants !== 'undefined') {
    return resolvedVariantsOf(matchingVariantOf(definition.variants, properties), seed)
  }
  if (typeof definition.multipart !== 'undefined') {
    return resolvedMultipartOf(definition.multipart, properties, seed)
  }
  throw new Error('A blockstate asset must define variants or multipart')
}

const modelOf = (assets: ResourcePackAssets, name: string): BlockModel | undefined =>
  findAsset(assets.models, name, 'model')

const emptyBuiltinModelOf = (name: string): ResolvedBlockModel => ({
  ambientOcclusion: DEFAULT_AMBIENT_OCCLUSION,
  elements: [],
  name,
  textures: {},
})

const missingModelOf = (name: string): ResolvedBlockModel => {
  if (name.startsWith('minecraft:builtin/')) {
    return emptyBuiltinModelOf(name)
  }
  throw new Error(`Missing model asset: ${name}`)
}

const parentModelOf = (
  model: BlockModel,
  assets: ResourcePackAssets,
  resolving: ReadonlySet<string>,
  resolve: (
    name: string,
    assets: ResourcePackAssets,
    resolving: ReadonlySet<string>,
  ) => ResolvedBlockModel,
): ResolvedBlockModel | undefined => {
  if (typeof model.parent === 'undefined') {
    return
  }
  return resolve(model.parent, assets, resolving)
}

const texturesOf = (model: BlockModel, parent: ResolvedBlockModel | undefined): Readonly<Record<string, string>> => ({
  ...(parent?.textures ?? {}),
  ...(model.textures ?? {}),
})

const elementsOf = (model: BlockModel, parent: ResolvedBlockModel | undefined): ReadonlyArray<ModelElement> => {
  if (typeof model.elements !== 'undefined') {
    return model.elements
  }
  if (typeof parent === 'undefined') {
    return []
  }
  return parent.elements
}

const ambientOcclusionOf = (model: BlockModel, parent: ResolvedBlockModel | undefined): boolean => {
  if (typeof model.ambientocclusion !== 'undefined') {
    return model.ambientocclusion
  }
  if (typeof parent === 'undefined') {
    return true
  }
  return parent.ambientOcclusion
}

const resolvedModelOf = (
  name: string,
  model: BlockModel,
  parent: ResolvedBlockModel | undefined,
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
  name: string,
  assets: ResourcePackAssets,
  resolving: ReadonlySet<string>,
): ResolvedBlockModel => {
  const canonicalName = normalizeResourceName(name, 'model')
  if (resolving.has(canonicalName)) {
    throw new Error(`Block model parent cycle: ${canonicalName}`)
  }
  const model = modelOf(assets, canonicalName)
  if (typeof model === 'undefined') {
    return missingModelOf(canonicalName)
  }
  const nextResolving = new Set([...resolving, canonicalName])
  const parent = parentModelOf(model, assets, nextResolving, resolveBlockModelInternal)
  return resolvedModelOf(canonicalName, model, parent)
}

/** Resolve model inheritance and merge inherited textures/elements. */
export const resolveBlockModel = (name: string, assets: ResourcePackAssets): ResolvedBlockModel =>
  resolveBlockModelInternal(name, assets, new Set<string>())

const textureValueOf = (model: ResolvedBlockModel, key: string, seen: Set<string>): string => {
  if (seen.has(key)) {
    throw new Error(`Texture reference cycle: ${key}`)
  }
  seen.add(key)
  const value = model.textures[key]
  if (typeof value === 'undefined') {
    throw new Error(`Missing texture variable: ${key}`)
  }
  return value
}

/** Resolve a texture key such as `#side` to its namespaced texture asset. */
export const resolveModelTexture = (model: ResolvedBlockModel, reference: string): string => {
  let current = reference
  const seen = new Set<string>()
  while (current.startsWith('#')) {
    current = textureValueOf(model, current.slice(INDEX_STEP), seen)
  }
  return normalizeTextureName(current)
}
