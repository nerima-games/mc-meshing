import { describe, expect, it } from 'vitest'
import {
  ResourcePackParseError,
  parseResourcePackAssets,
  parseResourcePackAssetsJson,
} from '../src/domain/resource-pack-schema.js'

const assets = {
  blockstates: {
    'minecraft:demo': {
      variants: {
        '': {
          model: 'block/demo',
          x: 90,
          y: 180,
          z: 270,
          uvlock: true,
          weight: 2,
        },
      },
    },
    'minecraft:multi': {
      multipart: [
        {
          when: { OR: [{ powered: 'true' }, { AND: [{ open: 'true' }] }] },
          apply: { model: 'block/demo', weight: 1 },
        },
        { apply: [{ model: 'block/empty' }] },
      ],
    },
  },
  models: {
    'minecraft:block/demo': {
      parent: 'block/base',
      ambientocclusion: false,
      textures: { side: 'block/side' },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          rotation: {
            origin: [8, 8, 8],
            axis: 'z',
            angle: 22.5,
            rescale: true,
          },
          shade: false,
          faces: {
            east: {
              texture: '#side',
              uv: [0, 0, 16, 16],
              rotation: 270,
              cullface: 'east',
              tintindex: 0,
            },
          },
        },
      ],
    },
    'minecraft:block/multi-axis': {
      textures: { side: 'block/side' },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          rotation: {
            origin: [8, 8, 8],
            x: 30.25,
            y: -15.5,
            z: 12.5,
            rescale: true,
          },
          faces: { up: { texture: '#side', cullface: 'up' } },
        },
      ],
    },
    'minecraft:block/legacy-precedence': {
      textures: { side: 'block/side' },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 16, 16],
          rotation: {
            origin: [8, 8, 8],
            axis: 'x',
            angle: 90,
            x: 30.25,
            y: -15.5,
            z: 12.5,
          },
          faces: { up: { texture: '#side' } },
        },
      ],
    },
  },
} as const

const caught = (operation: () => unknown): unknown => {
  try {
    operation()
  } catch (error) {
    return error
  }
  return null
}

describe('resource-pack schema', () => {
  it('decodes supported blockstate and model JSON values', () => {
    expect(parseResourcePackAssets(assets)).toEqual(assets)
    expect(parseResourcePackAssets({ blockstates: {}, models: {} })).toEqual({ blockstates: {}, models: {} })
  })

  it('parses a JSON document through the same typed contract', () => {
    expect(parseResourcePackAssetsJson(JSON.stringify(assets))).toEqual(assets)
  })

  it('rejects internal face names at the official JSON boundary', () => {
    expect(() =>
      parseResourcePackAssets({
        blockstates: {},
        models: {
          demo: {
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { xPos: { texture: '#side' } },
              },
            ],
          },
        },
      }),
    ).toThrow(ResourcePackParseError)
  })

  it('reports the input kind and schema path for invalid object data', () => {
    const error = caught(() =>
      parseResourcePackAssets({
        blockstates: {
          demo: { variants: { '': { model: 1 } } },
        },
        models: {},
      }),
    )

    expect(error).toBeInstanceOf(ResourcePackParseError)
    if (!(error instanceof ResourcePackParseError)) {
      throw new Error('expected a ResourcePackParseError')
    }
    expect(error.input).toBe('object')
    expect(error.message).toContain('model')
  })

  it('reports malformed JSON as a parse error', () => {
    const error = caught(() => parseResourcePackAssetsJson('{'))

    expect(error).toBeInstanceOf(ResourcePackParseError)
    if (!(error instanceof ResourcePackParseError)) {
      throw new Error('expected a ResourcePackParseError')
    }
    expect(error.input).toBe('json')
  })

  it('rejects non-finite model numbers and non-positive variant weights', () => {
    const invalidInputs: ReadonlyArray<unknown> = [
      {
        blockstates: { demo: { variants: { '': { model: 'block/demo', weight: 0 } } } },
        models: {},
      },
      {
        blockstates: {},
        models: {
          demo: {
            elements: [{ from: [Number.NaN, 0, 0], to: [16, 16, 16], faces: {} }],
          },
        },
      },
      {
        blockstates: {},
        models: {
          demo: {
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { east: { texture: '#side', tintindex: Number.POSITIVE_INFINITY } },
              },
            ],
          },
        },
      },
      {
        blockstates: {},
        models: {
          demo: {
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                rotation: { origin: [8, 8, 8], axis: 'x' },
                faces: {},
              },
            ],
          },
        },
      },
      {
        blockstates: {},
        models: {
          demo: {
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                rotation: { origin: [8, 8, 8] },
                faces: {},
              },
            ],
          },
        },
      },
      {
        blockstates: {},
        models: {
          demo: {
            elements: [
              {
                from: [0, 0, 0],
                to: [16, 16, 16],
                rotation: { origin: [8, 8, 8], x: Number.POSITIVE_INFINITY },
                faces: {},
              },
            ],
          },
        },
      },
    ]

    for (const input of invalidInputs) {
      expect(() => parseResourcePackAssets(input)).toThrow(ResourcePackParseError)
    }
  })

  it('rejects empty blockstate variant lists at the JSON boundary', () => {
    const error = caught(() =>
      parseResourcePackAssets({
        blockstates: { demo: { variants: { '': [] } } },
        models: {},
      }),
    )

    expect(error).toBeInstanceOf(ResourcePackParseError)
    if (!(error instanceof ResourcePackParseError)) {
      throw new Error('expected a ResourcePackParseError')
    }
    expect(error.input).toBe('object')
  })

  it('requires exactly one blockstate selection mode', () => {
    for (const definition of [
      {},
      { variants: {}, multipart: [] },
    ]) {
      const error = caught(() =>
        parseResourcePackAssets({
          blockstates: { demo: definition },
          models: {},
        }),
      )

      expect(error).toBeInstanceOf(ResourcePackParseError)
    }
  })
})
