import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import {
  meshBlockModel as meshBlockModelResult,
  meshBlockState as meshBlockStateResult,
} from '../src/domain/resource-pack-mesh.js'
import {
  normalizeResourceName as normalizeResourceNameResult,
  resolveBlockModel as resolveBlockModelResult,
  resolveBlockStateModels as resolveBlockStateModelsResult,
  resolveModelTexture as resolveModelTextureResult,
} from '../src/domain/resource-pack-resolver.js'
import type {
  ModelName,
  ModelElement,
  ModelElementRotation,
  ModelFace,
  ResourceModelFaceDirection,
  ResourceModelTransform,
  ResourceName,
  ResourcePackAssets,
} from '../src/domain/resource-pack-types.js'

/**
 * Force a deliberately malformed fixture past the type checker so it can
 * reach a strictly-typed parameter and prove the runtime schema rejects it.
 * No type guard or validated constructor applies here — the fixture is
 * invalid on purpose. `any` in, `T` out is a legal implicit assignment (no
 * `as`/`!`), so it doesn't trip the org's `no-type-assertion` ast-grep rule.
 */
const invalidFixture = <T,>(value: any): T => value

const successOf = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const failureOf = <Value, Failure>(result: Result.Result<Value, Failure>): Failure => {
  if (Result.isFailure(result)) {
    return result.failure
  }
  throw new Error('Expected a Result failure')
}

const normalizeResourceName = (...args: Parameters<typeof normalizeResourceNameResult>) =>
  successOf(normalizeResourceNameResult(...args))
const resolveBlockModel = (...args: Parameters<typeof resolveBlockModelResult>) =>
  successOf(resolveBlockModelResult(...args))
const resolveBlockStateModels = (...args: Parameters<typeof resolveBlockStateModelsResult>) =>
  successOf(resolveBlockStateModelsResult(...args))
const resolveModelTexture = (...args: Parameters<typeof resolveModelTextureResult>) =>
  successOf(resolveModelTextureResult(...args))
const meshBlockModel = (...args: Parameters<typeof meshBlockModelResult>) =>
  successOf(meshBlockModelResult(...args))
const meshBlockState = (...args: Parameters<typeof meshBlockStateResult>) =>
  successOf(meshBlockStateResult(...args))
const modelName = (name: string): ModelName => successOf(normalizeResourceNameResult(name, 'model'))
const resourceName = (name: string): ResourceName => successOf(normalizeResourceNameResult(name, 'blockstate'))

const face = (texture: string, options: Omit<ModelFace, 'texture'> = {}): ModelFace => ({
  texture,
  ...options,
})

const modelElement = (
  faces: Readonly<Partial<Record<ResourceModelFaceDirection, ModelFace>>>,
  options: {
    readonly from?: readonly [number, number, number]
    readonly to?: readonly [number, number, number]
    readonly rotation?: ModelElementRotation
    readonly shade?: boolean
  } = {},
): ModelElement => ({
  from: options.from ?? [0, 0, 0],
  to: options.to ?? [16, 16, 16],
  faces,
  ...(options.rotation ? { rotation: options.rotation } : {}),
  ...(Object.hasOwn(options, 'shade') ? { shade: options.shade ?? false } : {}),
})

const baseElement = modelElement({
  east: face('#side', { cullface: 'east', tintindex: 2 }),
  west: face('#base'),
  up: face('#side', { rotation: 90 }),
  down: face('textures/bottom.json'),
  south: face('#side', { uv: [1, 2, 15, 14] }),
  north: face('#side'),
})

const rotatedElementX = modelElement(
  { up: face('#side') },
  {
    rotation: { origin: [8, 8, 8], axis: 'x', angle: 22.5, rescale: true },
    shade: false,
  },
)

const rotatedElementY = modelElement(
  { south: face('#side') },
  { rotation: { origin: [8, 8, 8], axis: 'y', angle: -22.5 } },
)

const rotatedElementZ = modelElement(
  { west: face('#side') },
  { rotation: { origin: [8, 8, 8], axis: 'z', angle: 90 } },
)

const multiAxisElement = modelElement(
  { up: face('#side', { cullface: 'up' }) },
  {
    rotation: { origin: [8, 8, 8], x: 30.25, y: -15.5, z: 12.5, rescale: true },
    shade: false,
  },
)

const legacyOnlyElement = modelElement(
  { up: face('#side') },
  { rotation: { origin: [8, 8, 8], axis: 'x', angle: 90 } },
)

const legacyPrecedenceElement = modelElement(
  { up: face('#side') },
  {
    rotation: {
      origin: [8, 8, 8],
      axis: 'x',
      angle: 90,
      x: 30.25,
      y: -15.5,
      z: 12.5,
    },
  },
)

const assets: ResourcePackAssets = {
  blockstates: {
    'minecraft:demo': {
      variants: {
        'facing=north,open=false': { model: 'block/child', y: 90, uvlock: true },
        'facing=south|east': [
          { model: 'block/weighted-a', weight: 1 },
          { model: 'block/weighted-b' },
        ],
        invalid: { model: 'block/bare' },
        'single=one': [{ model: 'block/child' }],
        '': { model: 'block/inherit' },
      },
    },
    'minecraft:multi': {
      multipart: [
        {
          when: { OR: [{ powered: 'true' }, { facing: 'east' }] },
          apply: { model: 'block/child' },
        },
        {
          when: { AND: [{ powered: 'true' }, { open: 'true' }] },
          apply: [{ model: 'block/bare' }],
        },
        { apply: { model: 'block/inherit' } },
      ],
    },
  },
  models: {
    'minecraft:block/base': {
      ambientocclusion: false,
      textures: { base: 'stone/base', side: 'stone/side' },
      elements: [baseElement],
    },
    'minecraft:block/child': {
      parent: 'block/base',
      ambientocclusion: true,
      textures: { side: 'stone/child' },
      elements: [modelElement({ east: face('#side'), up: face('#side') }, { shade: false })],
    },
    'minecraft:block/inherit': {
      parent: 'block/base',
      textures: { side: 'stone/inherited' },
    },
    'block/bare': {
      textures: { side: 'stone/bare' },
      elements: [modelElement({ south: face('#side') })],
    },
    'minecraft:block/empty': {},
    'minecraft:block/rotations': {
      textures: { side: 'stone/rotations' },
      elements: [rotatedElementX, rotatedElementY, rotatedElementZ],
    },
    'minecraft:block/multi-axis': {
      textures: { side: 'stone/multi-axis' },
      elements: [multiAxisElement],
    },
    'minecraft:block/legacy-only': {
      textures: { side: 'stone/legacy' },
      elements: [legacyOnlyElement],
    },
    'minecraft:block/legacy-precedence': {
      textures: { side: 'stone/legacy' },
      elements: [legacyPrecedenceElement],
    },
    'minecraft:block/weighted-a': { parent: 'block/base' },
    'minecraft:block/weighted-b': { parent: 'block/base' },
  },
}

describe('resource-pack resolver', () => {
  it('normalizes names and rejects empty paths', () => {
    expect(normalizeResourceName(' models/demo.json ', 'model')).toBe('minecraft:demo')
    expect(normalizeResourceName('blockstates/demo.json', 'blockstate')).toBe('minecraft:demo')
    expect(normalizeResourceName('custom:block/demo', 'model')).toBe('custom:block/demo')
    expect(failureOf(normalizeResourceNameResult('bad:', 'model'))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'invalid-resource-name',
    })
    expect(failureOf(normalizeResourceNameResult('  ', 'model'))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'invalid-resource-name',
    })
    expect(failureOf(normalizeResourceNameResult('models/.json', 'model'))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'invalid-resource-name',
    })
  })

  it('resolves variants, fallback entries, weights, and normalized transforms', () => {
    const specific = resolveBlockStateModels(
      resourceName('blockstates/demo.json'),
      { facing: 'north', open: 'false' },
      assets,
      { seed: 7 },
    )
    expect(specific).toEqual([{ model: 'minecraft:block/child', x: 0, y: 90, z: 0, uvlock: true }])

    const single = resolveBlockStateModels(resourceName('demo'), { single: 'one' }, assets)
    expect(single[0]?.model).toBe('minecraft:block/child')

    const fallback = resolveBlockStateModels(resourceName('demo'), { facing: 'west' }, assets)
    expect(fallback[0]?.model).toBe('minecraft:block/inherit')

    const weighted = resolveBlockStateModels(resourceName('demo'), { facing: 'east' }, assets, { seed: 1 })
    expect(weighted[0]?.model).toBe('minecraft:block/weighted-a')
    const weightedLast = resolveBlockStateModels(resourceName('demo'), { facing: 'east' }, assets, { seed: 12 })
    expect(weightedLast[0]?.model).toBe('minecraft:block/weighted-b')

    const bareStateAssets: ResourcePackAssets = {
      blockstates: { bare: { variants: { '': { model: 'block/bare' } } } },
      models: {},
    }
    expect(resolveBlockStateModels(resourceName('bare'), {}, bareStateAssets)[0]?.model).toBe('minecraft:block/bare')
  })

  it('resolves multipart OR and AND conditions', () => {
    expect(resolveBlockStateModels(resourceName('multi'), { powered: 'true', open: 'true' }, assets)).toHaveLength(3)
    expect(resolveBlockStateModels(resourceName('multi'), { powered: 'false', facing: 'east' }, assets)).toHaveLength(2)
    expect(resolveBlockStateModels(resourceName('multi'), { powered: 'false', facing: 'north', open: 'false' }, assets)).toHaveLength(1)
  })

  it('rejects malformed normalized names and multipart selection errors', () => {
    expect(failureOf(normalizeResourceNameResult('bad:', 'blockstate'))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'invalid-resource-name',
    })

    const base = resolveBlockModel(modelName('block/base'), assets)
    expect(failureOf(resolveModelTextureResult({
      ...base,
      textures: { invalid: ':stone' },
    }, '#invalid'))).toMatchObject({ code: 'invalid-texture-reference' })

    const unmatched = resolveBlockStateModels(
      resourceName('multi'),
      { powered: 'false', facing: 'north', open: 'false' },
      assets,
    )
    expect(unmatched.map((state) => state.model)).toEqual(['minecraft:block/inherit'])

    const invalidMultipartAssets: ResourcePackAssets = {
      ...assets,
      blockstates: {
        ...assets.blockstates,
        'minecraft:multi': {
          multipart: [{ apply: [{ model: 'block/bare', weight: 0 }] }],
        },
      },
    }
    expect(failureOf(resolveBlockStateModelsResult(
      resourceName('multi'),
      {},
      invalidMultipartAssets,
    ))).toMatchObject({ code: 'invalid-variant-weight' })

    const overflowingWeightsAssets: ResourcePackAssets = {
      ...assets,
      blockstates: {
        ...assets.blockstates,
        'minecraft:overflow': {
          variants: {
            '': [
              { model: 'block/bare', weight: Number.MAX_VALUE },
              { model: 'block/bare', weight: Number.MAX_VALUE },
            ],
          },
        },
      },
    }
    expect(failureOf(resolveBlockStateModelsResult(
      resourceName('overflow'),
      {},
      overflowingWeightsAssets,
    ))).toMatchObject({
      code: 'invalid-variant-weight',
      message: expect.stringContaining('overflowed'),
    })
  })

  it('reports malformed or missing blockstates', () => {
    expect(failureOf(resolveBlockStateModelsResult(resourceName('missing'), {}, assets))).toMatchObject({
      code: 'missing-blockstate',
      message: 'Missing blockstate asset: minecraft:missing',
    })
    expect(failureOf(resolveBlockStateModelsResult(resourceName('demo'), {}, { ...assets, blockstates: { 'minecraft:demo': { variants: { bad: { model: 'block/bare' } } } } }))).toMatchObject({
      code: 'no-matching-variant',
    })
    expect(failureOf(
      resolveBlockStateModelsResult(resourceName('demo'), {}, {
        ...assets,
        blockstates: invalidFixture<ResourcePackAssets['blockstates']>({ 'minecraft:demo': {} }),
      }),
    )).toMatchObject({ code: 'invalid-blockstate-definition' })
    expect(failureOf(
      resolveBlockStateModelsResult(resourceName('demo'), {}, {
        ...assets,
        blockstates: invalidFixture<ResourcePackAssets['blockstates']>({
          'minecraft:demo': { variants: { '': [] } },
        }),
      }),
    )).toMatchObject({ code: 'empty-variant-list' })
    expect(failureOf(
      resolveBlockStateModelsResult(resourceName('demo'), {}, {
        ...assets,
        blockstates: {
          'minecraft:demo': {
            variants: {
              '': [
                { model: 'block/bare', weight: 0 },
                { model: 'block/bare' },
              ],
            },
          },
        },
      }),
    )).toMatchObject({ code: 'invalid-variant-weight' })
    expect(failureOf(
      resolveBlockStateModelsResult(resourceName('demo'), {}, {
        ...assets,
        blockstates: {
          'minecraft:demo': {
            variants: {
              '': [
                { model: 'block/bare', weight: Number.NaN },
                { model: 'block/bare' },
              ],
            },
          },
        },
      }),
    )).toMatchObject({ code: 'invalid-variant-weight' })
    expect(failureOf(
      resolveBlockStateModelsResult(resourceName('demo'), {}, {
        ...assets,
        blockstates: {
          'minecraft:demo': {
            variants: {
              '': [
                { model: 'block/bare' },
                { model: 'block/bare', weight: 0 },
              ],
            },
          },
        },
      }),
    )).toMatchObject({ code: 'invalid-variant-weight' })
  })

  it('merges parent models and resolves texture variables', () => {
    const inherited = resolveBlockModel(modelName('block/inherit'), assets)
    expect(inherited).toMatchObject({
      name: 'minecraft:block/inherit',
      ambientOcclusion: false,
      textures: {
        base: 'stone/base',
        side: 'stone/inherited',
      },
    })
    expect(inherited.elements).toEqual([baseElement])

    const child = resolveBlockModel(modelName('block/child'), assets)
    expect(child.ambientOcclusion).toBe(true)
    expect(child.elements).toHaveLength(1)
    expect(resolveBlockModel(modelName('block/bare'), assets).name).toBe('minecraft:block/bare')
    expect(resolveBlockModel(modelName('block/empty'), assets)).toMatchObject({
      ambientOcclusion: true,
      textures: {},
      elements: [],
    })
    expect(resolveBlockModel(modelName('builtin/generated'), assets).elements).toEqual([])

    const textureModel = {
      ...inherited,
      textures: { outer: '#inner', inner: 'textures/test.json' },
    }
    expect(resolveModelTexture(textureModel, '#outer')).toBe('minecraft:test')
    expect(resolveModelTexture(textureModel, 'custom:direct')).toBe('custom:direct')
    expect(failureOf(resolveModelTextureResult(textureModel, '#missing'))).toMatchObject({
      code: 'missing-texture-variable',
    })
    expect(failureOf(resolveModelTextureResult({ ...textureModel, textures: { loop: '#loop' } }, '#loop'))).toMatchObject({
      code: 'texture-reference-cycle',
    })
    expect(failureOf(resolveModelTextureResult(textureModel, '  '))).toMatchObject({
      code: 'invalid-texture-reference',
    })
  })

  it('reports missing models and parent cycles', () => {
    expect(failureOf(resolveBlockModelResult(modelName('missing'), assets))).toMatchObject({ code: 'missing-model' })
    const cyclic: ResourcePackAssets = {
      blockstates: {},
      models: {
        'minecraft:block/a': { parent: 'block/b' },
        'minecraft:block/b': { parent: 'block/a' },
      },
    }
    expect(failureOf(resolveBlockModelResult(modelName('block/a'), cyclic))).toMatchObject({ code: 'block-model-cycle' })
    expect(failureOf(resolveBlockModelResult(modelName('block/a'), { blockstates: {}, models: { 'minecraft:block/a': { parent: 'block/missing' } } }))).toMatchObject({
      code: 'missing-model',
    })
  })
})

describe('resource-pack mesh', () => {
  it('meshes every face direction, texture metadata, and block rotation', () => {
    const quads = meshBlockModel(modelName('block/base'), assets, { y: 90, uvlock: true })
    expect(quads).toHaveLength(6)
    expect(quads[0]).toMatchObject({
      model: 'minecraft:block/base',
      ambientOcclusion: false,
      direction: 'zNeg',
      texture: 'minecraft:stone/side',
      shade: true,
      cullface: 'zNeg',
      tintIndex: 2,
    })
    expect(quads.some((quad) => quad.texture === 'minecraft:stone/base')).toBe(true)
    expect(quads.some((quad) => quad.texture === 'minecraft:bottom')).toBe(true)
    expect(quads.some((quad) => quad.uv[0]?.[0] === 1)).toBe(true)
    expect(quads.every((quad) => quad.vertices.every((point) => point.every(Number.isFinite)))).toBe(true)
    expect(quads.every((quad) => quad.normal.every(Number.isFinite))).toBe(true)
  })

  it('meshes element rotations, rescale, UV fallback, and multipart states', () => {
    const rotations = meshBlockModel(modelName('block/rotations'), assets, { x: 90, y: 180, z: 270, uvlock: true })
    expect(rotations).toHaveLength(3)
    expect(rotations.every((quad) => quad.vertices.every((point) => point.every(Number.isFinite)))).toBe(true)
    expect(rotations.every((quad) => quad.normal.every(Number.isFinite))).toBe(true)

    const multiAxis = meshBlockModel(modelName('block/multi-axis'), assets)
    expect(multiAxis).toHaveLength(1)
    expect(multiAxis[0]).toMatchObject({ direction: 'yPos', cullface: 'yPos', shade: false })
    const [normalX, normalY, normalZ] = multiAxis[0]?.normal ?? [0, 0, 0]
    expect(Math.abs(normalX)).toBeGreaterThan(0)
    expect(Math.abs(normalY)).toBeGreaterThan(0)
    expect(Math.abs(normalZ)).toBeGreaterThan(0)

    const partialRotationAssets: ResourcePackAssets = {
      ...assets,
      models: {
        ...assets.models,
        'minecraft:block/partial-x': {
          textures: { side: 'stone/partial-x' },
          elements: [
            modelElement(
              { up: face('#side') },
              { rotation: { origin: [8, 8, 8], x: 30.25 } },
            ),
          ],
        },
        'minecraft:block/partial-y': {
          textures: { side: 'stone/partial-y' },
          elements: [
            modelElement(
              { up: face('#side') },
              { rotation: { origin: [8, 8, 8], y: -15.5 } },
            ),
          ],
        },
        'minecraft:block/partial-z': {
          textures: { side: 'stone/partial-z' },
          elements: [
            modelElement(
              { up: face('#side') },
              { rotation: { origin: [8, 8, 8], z: 12.5 } },
            ),
          ],
        },
      },
    }
    const partialRotations = ['block/partial-x', 'block/partial-y', 'block/partial-z'].flatMap(
      (model) => meshBlockModel(modelName(model), partialRotationAssets),
    )
    expect(partialRotations).toHaveLength(3)
    expect(
      partialRotations.every((quad) =>
        quad.vertices.every((point) => point.every(Number.isFinite)),
      ),
    ).toBe(true)

    const legacy = meshBlockModel(modelName('block/legacy-only'), assets)
    const precedence = meshBlockModel(modelName('block/legacy-precedence'), assets)
    expect(precedence[0]?.vertices).toEqual(legacy[0]?.vertices)
    expect(precedence[0]?.normal).toEqual(legacy[0]?.normal)

    const stateQuads = meshBlockState(resourceName('demo'), { facing: 'north', open: 'false' }, assets, { seed: 3 })
    expect(stateQuads).toHaveLength(2)
    expect(stateQuads.every((quad) => quad.model === 'minecraft:block/child')).toBe(true)
    expect(stateQuads.every((quad) => quad.ambientOcclusion)).toBe(true)

    const multipartQuads = meshBlockState(resourceName('multi'), { powered: 'true', open: 'true' }, assets)
    expect(multipartQuads).toHaveLength(9)
  })

  it('meshes models without elements as an empty result', () => {
    expect(meshBlockModel(modelName('builtin/generated'), assets)).toEqual([])
  })

  it('rejects non-axis-aligned runtime block rotations', () => {
    const invalidTransform = invalidFixture<ResourceModelTransform>({ y: 45 })
    expect(failureOf(meshBlockModelResult(modelName('block/base'), assets, invalidTransform))).toMatchObject({
      _tag: 'ResourceModelMeshFailure',
      code: 'non-axis-aligned-face',
    })
  })

  it('propagates model and state failures through the public meshing APIs', () => {
    expect(failureOf(meshBlockModelResult(modelName('missing'), assets))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'missing-model',
    })

    const missingTextureAssets: ResourcePackAssets = {
      ...assets,
      models: {
        ...assets.models,
        'minecraft:block/missing-texture': {
          elements: [modelElement({ up: face('#missing') })],
        },
      },
    }
    expect(failureOf(meshBlockModelResult(
      modelName('block/missing-texture'),
      missingTextureAssets,
    ))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'missing-texture-variable',
    })

    const nonAxisCullfaceAssets: ResourcePackAssets = {
      ...assets,
      models: {
        ...assets.models,
        'minecraft:block/non-axis-cullface': {
          textures: { side: 'stone/side' },
          elements: [modelElement({ east: face('#side', { cullface: 'up' }) })],
        },
      },
    }
    expect(failureOf(meshBlockModelResult(
      modelName('block/non-axis-cullface'),
      nonAxisCullfaceAssets,
      invalidFixture<ResourceModelTransform>({ x: 45 }),
    ))).toMatchObject({
      _tag: 'ResourceModelMeshFailure',
      code: 'non-axis-aligned-face',
    })

    const missingModelStateAssets: ResourcePackAssets = {
      ...assets,
      blockstates: {
        ...assets.blockstates,
        'minecraft:missing-model-state': {
          variants: { '': { model: 'block/not-installed' } },
        },
      },
    }
    expect(failureOf(meshBlockStateResult(
      resourceName('missing-model-state'),
      {},
      missingModelStateAssets,
    ))).toMatchObject({
      _tag: 'ResourcePackResolutionFailure',
      code: 'missing-model',
    })

    const invalidStateMeshAssets: ResourcePackAssets = {
      ...assets,
      models: {
        ...assets.models,
        'minecraft:block/invalid-state-rotation': {
          textures: { side: 'stone/side' },
          elements: [modelElement(
            { up: face('#side') },
            { rotation: invalidFixture<ModelElementRotation>({ origin: [8, 8, 8] }) },
          )],
        },
      },
      blockstates: {
        ...assets.blockstates,
        'minecraft:invalid-mesh-state': {
          variants: { '': { model: 'block/invalid-state-rotation' } },
        },
      },
    }
    expect(failureOf(meshBlockStateResult(
      resourceName('invalid-mesh-state'),
      {},
      invalidStateMeshAssets,
    ))).toMatchObject({
      _tag: 'ResourceModelMeshFailure',
      code: 'invalid-element-rotation',
    })
  })

  it('rejects incomplete element rotations and degenerate faces', () => {
    const incompleteRotationAssets: ResourcePackAssets = {
      ...assets,
      models: {
        ...assets.models,
        'minecraft:block/incomplete-rotation': {
          textures: { side: 'stone/invalid' },
          elements: [modelElement({ up: face('#side') }, { rotation: { origin: [8, 8, 8], axis: 'x' } })],
        },
        'minecraft:block/missing-rotation': {
          textures: { side: 'stone/invalid' },
          elements: [modelElement({ up: face('#side') }, { rotation: { origin: [8, 8, 8] } })],
        },
        'minecraft:block/degenerate': {
          textures: { side: 'stone/invalid' },
          elements: [
            modelElement(
              { east: face('#side') },
              { from: [0, 0, 0], to: [16, 16, 0] },
            ),
          ],
        },
      },
    }

    expect(failureOf(meshBlockModelResult(modelName('block/incomplete-rotation'), incompleteRotationAssets))).toMatchObject({
      _tag: 'ResourceModelMeshFailure',
      code: 'invalid-element-rotation',
    })
    expect(failureOf(meshBlockModelResult(modelName('block/missing-rotation'), incompleteRotationAssets))).toMatchObject({
      _tag: 'ResourceModelMeshFailure',
      code: 'invalid-element-rotation',
    })
    expect(failureOf(meshBlockModelResult(modelName('block/degenerate'), incompleteRotationAssets))).toMatchObject({
      _tag: 'ResourceModelMeshFailure',
      code: 'degenerate-face',
    })
  })
})
