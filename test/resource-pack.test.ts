import { describe, expect, it } from 'vitest'
import {
  meshBlockModel,
  meshBlockState,
} from '../src/domain/resource-pack-mesh.js'
import {
  normalizeResourceName,
  resolveBlockModel,
  resolveBlockStateModels,
  resolveModelTexture,
} from '../src/domain/resource-pack-resolver.js'
import type {
  ModelElement,
  ModelElementRotation,
  ModelFace,
  ResourceModelFaceDirection,
  ResourceModelTransform,
  ResourcePackAssets,
} from '../src/domain/resource-pack-types.js'

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
    expect(() => normalizeResourceName('  ', 'model')).toThrow(RangeError)
    expect(() => normalizeResourceName('models/.json', 'model')).toThrow(RangeError)
  })

  it('resolves variants, fallback entries, weights, and normalized transforms', () => {
    const specific = resolveBlockStateModels(
      'blockstates/demo.json',
      { facing: 'north', open: 'false' },
      assets,
      { seed: 7 },
    )
    expect(specific).toEqual([{ model: 'minecraft:block/child', x: 0, y: 90, z: 0, uvlock: true }])

    const single = resolveBlockStateModels('demo', { single: 'one' }, assets)
    expect(single[0]?.model).toBe('minecraft:block/child')

    const fallback = resolveBlockStateModels('demo', { facing: 'west' }, assets)
    expect(fallback[0]?.model).toBe('minecraft:block/inherit')

    const weighted = resolveBlockStateModels('demo', { facing: 'east' }, assets, { seed: 1 })
    expect(weighted[0]?.model).toBe('minecraft:block/weighted-a')
    const weightedLast = resolveBlockStateModels('demo', { facing: 'east' }, assets, { seed: 12 })
    expect(weightedLast[0]?.model).toBe('minecraft:block/weighted-b')

    const bareStateAssets: ResourcePackAssets = {
      blockstates: { bare: { variants: { '': { model: 'block/bare' } } } },
      models: {},
    }
    expect(resolveBlockStateModels('bare', {}, bareStateAssets)[0]?.model).toBe('minecraft:block/bare')
  })

  it('resolves multipart OR and AND conditions', () => {
    expect(resolveBlockStateModels('multi', { powered: 'true', open: 'true' }, assets)).toHaveLength(3)
    expect(resolveBlockStateModels('multi', { powered: 'false', facing: 'east' }, assets)).toHaveLength(2)
    expect(resolveBlockStateModels('multi', { powered: 'false', facing: 'north', open: 'false' }, assets)).toHaveLength(1)
  })

  it('reports malformed or missing blockstates', () => {
    expect(() => resolveBlockStateModels('missing', {}, assets)).toThrow('Missing blockstate asset')
    expect(() => resolveBlockStateModels('demo', {}, { ...assets, blockstates: { 'minecraft:demo': { variants: { bad: { model: 'block/bare' } } } } })).toThrow(
      'No blockstate variant',
    )
    expect(() =>
      resolveBlockStateModels('demo', {}, {
        ...assets,
        blockstates: { 'minecraft:demo': {} } as unknown as ResourcePackAssets['blockstates'],
      }),
    ).toThrow('must define variants or multipart')
    expect(() =>
      resolveBlockStateModels('demo', {}, {
        ...assets,
        blockstates: {
          'minecraft:demo': { variants: { '': [] } },
        } as unknown as ResourcePackAssets['blockstates'],
      }),
    ).toThrow('must not be empty')
    expect(() =>
      resolveBlockStateModels('demo', {}, {
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
    ).toThrow('positive and finite')
    expect(() =>
      resolveBlockStateModels('demo', {}, {
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
    ).toThrow('positive and finite')
  })

  it('merges parent models and resolves texture variables', () => {
    const inherited = resolveBlockModel('block/inherit', assets)
    expect(inherited).toMatchObject({
      name: 'minecraft:block/inherit',
      ambientOcclusion: false,
      textures: {
        base: 'stone/base',
        side: 'stone/inherited',
      },
    })
    expect(inherited.elements).toEqual([baseElement])

    const child = resolveBlockModel('block/child', assets)
    expect(child.ambientOcclusion).toBe(true)
    expect(child.elements).toHaveLength(1)
    expect(resolveBlockModel('block/bare', assets).name).toBe('minecraft:block/bare')
    expect(resolveBlockModel('block/empty', assets)).toMatchObject({
      ambientOcclusion: true,
      textures: {},
      elements: [],
    })
    expect(resolveBlockModel('builtin/generated', assets).elements).toEqual([])

    const textureModel = {
      ...inherited,
      textures: { outer: '#inner', inner: 'textures/test.json' },
    }
    expect(resolveModelTexture(textureModel, '#outer')).toBe('minecraft:test')
    expect(resolveModelTexture(textureModel, 'custom:direct')).toBe('custom:direct')
    expect(() => resolveModelTexture(textureModel, '#missing')).toThrow('Missing texture variable')
    expect(() => resolveModelTexture({ ...textureModel, textures: { loop: '#loop' } }, '#loop')).toThrow(
      'Texture reference cycle',
    )
    expect(() => resolveModelTexture(textureModel, '  ')).toThrow('must not be empty')
  })

  it('reports missing models and parent cycles', () => {
    expect(() => resolveBlockModel('missing', assets)).toThrow('Missing model asset')
    const cyclic: ResourcePackAssets = {
      blockstates: {},
      models: {
        'minecraft:block/a': { parent: 'block/b' },
        'minecraft:block/b': { parent: 'block/a' },
      },
    }
    expect(() => resolveBlockModel('block/a', cyclic)).toThrow('parent cycle')
    expect(() => resolveBlockModel('block/a', { blockstates: {}, models: { 'minecraft:block/a': { parent: 'block/missing' } } })).toThrow(
      'Missing model asset',
    )
  })
})

describe('resource-pack mesh', () => {
  it('meshes every face direction, texture metadata, and block rotation', () => {
    const quads = meshBlockModel('block/base', assets, { y: 90, uvlock: true })
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
    const rotations = meshBlockModel('block/rotations', assets, { x: 90, y: 180, z: 270, uvlock: true })
    expect(rotations).toHaveLength(3)
    expect(rotations.every((quad) => quad.vertices.every((point) => point.every(Number.isFinite)))).toBe(true)
    expect(rotations.every((quad) => quad.normal.every(Number.isFinite))).toBe(true)

    const multiAxis = meshBlockModel('block/multi-axis', assets)
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
      (model) => meshBlockModel(model, partialRotationAssets),
    )
    expect(partialRotations).toHaveLength(3)
    expect(
      partialRotations.every((quad) =>
        quad.vertices.every((point) => point.every(Number.isFinite)),
      ),
    ).toBe(true)

    const legacy = meshBlockModel('block/legacy-only', assets)
    const precedence = meshBlockModel('block/legacy-precedence', assets)
    expect(precedence[0]?.vertices).toEqual(legacy[0]?.vertices)
    expect(precedence[0]?.normal).toEqual(legacy[0]?.normal)

    const stateQuads = meshBlockState('demo', { facing: 'north', open: 'false' }, assets, { seed: 3 })
    expect(stateQuads).toHaveLength(2)
    expect(stateQuads.every((quad) => quad.model === 'minecraft:block/child')).toBe(true)
    expect(stateQuads.every((quad) => quad.ambientOcclusion)).toBe(true)

    const multipartQuads = meshBlockState('multi', { powered: 'true', open: 'true' }, assets)
    expect(multipartQuads).toHaveLength(9)
  })

  it('meshes models without elements as an empty result', () => {
    expect(meshBlockModel('builtin/generated', assets)).toEqual([])
  })

  it('rejects non-axis-aligned runtime block rotations', () => {
    const invalidTransform = { y: 45 } as unknown as ResourceModelTransform
    expect(() => meshBlockModel('block/base', assets, invalidTransform)).toThrow('axis-aligned')
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

    expect(() => meshBlockModel('block/incomplete-rotation', incompleteRotationAssets)).toThrow('provided together')
    expect(() => meshBlockModel('block/missing-rotation', incompleteRotationAssets)).toThrow('axis/angle or x/y/z')
    expect(() => meshBlockModel('block/degenerate', incompleteRotationAssets)).toThrow('non-zero area')
  })
})
