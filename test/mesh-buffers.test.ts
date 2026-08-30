import { describe, expect, it } from 'vitest'
import type { BlockId } from '@nerima-games/mc-kernel'
import {
  MESH_BUFFER_LAYERS,
  packMeshLayers,
  type MeshLayers,
  type Quad,
} from '../src/index.js'
import { facePlacementOf } from '../src/domain/faces.js'

type MutableMeshLayers = {
  -readonly [K in keyof MeshLayers]: MeshLayers[K]
}

const emptyLayers = (): MutableMeshLayers => ({
  opaque: [],
  water: [],
  transparentSolid: [],
  crossPlants: [],
  fluids: [],
  specialBlocks: [],
})

const cubeQuadOf = (direction: Quad['direction']): Quad => ({
  ...facePlacementOf(direction),
  blockId: 1 as BlockId,
  lx: 2,
  y: 3,
  lz: 4,
  width: 2,
  height: 3,
  ao: 2,
})

describe('packMeshLayers', () => {
  it('returns empty typed buffers and stable empty groups', () => {
    const result = packMeshLayers(emptyLayers())

    expect(Array.from(result.positions)).toStrictEqual([])
    expect(Array.from(result.normals)).toStrictEqual([])
    expect(Array.from(result.blockIds)).toStrictEqual([])
    expect(Array.from(result.ambientOcclusion)).toStrictEqual([])
    expect(Array.from(result.indices)).toStrictEqual([])
    expect(result.groups).toStrictEqual(
      MESH_BUFFER_LAYERS.map((layer) => ({
        layer,
        vertexOffset: 0,
        vertexCount: 0,
        indexOffset: 0,
        indexCount: 0,
      })),
    )
  })

  it('packs cube quads with direction-specific winding and normals', () => {
    const layers = emptyLayers()
    layers.opaque = (
      ['xPos', 'xNeg', 'yPos', 'yNeg', 'zPos', 'zNeg'] as const
    ).map(cubeQuadOf)

    const result = packMeshLayers(layers)

    expect(Array.from(result.positions)).toStrictEqual([
      3, 3, 4, 3, 5, 4, 3, 5, 7, 3, 3, 7,
      2, 3, 7, 2, 5, 7, 2, 5, 4, 2, 3, 4,
      2, 4, 4, 2, 4, 7, 4, 4, 7, 4, 4, 4,
      2, 3, 7, 2, 3, 4, 4, 3, 4, 4, 3, 7,
      4, 3, 5, 4, 6, 5, 2, 6, 5, 2, 3, 5,
      2, 3, 4, 2, 6, 4, 4, 6, 4, 4, 3, 4,
    ])
    expect(Array.from(result.normals)).toStrictEqual(
      [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ].flatMap((normal) => Array.from({ length: 4 }, () => normal).flat()),
    )
    expect(Array.from(result.blockIds)).toStrictEqual(Array(24).fill(1))
    expect(Array.from(result.ambientOcclusion)).toStrictEqual(
      Array(24).fill(2),
    )
    expect(Array.from(result.indices)).toStrictEqual(
      Array.from({ length: 6 }, (_, quadIndex) => {
        const vertexOffset = quadIndex * 4
        return [
          vertexOffset,
          vertexOffset + 1,
          vertexOffset + 2,
          vertexOffset,
          vertexOffset + 2,
          vertexOffset + 3,
        ]
      }).flat(),
    )
    expect(result.groups[0]).toStrictEqual({
      layer: 'opaque',
      vertexOffset: 0,
      vertexCount: 24,
      indexOffset: 0,
      indexCount: 36,
    })
  })

  it('packs plants, fluids, and special geometry into separate groups', () => {
    const layers = emptyLayers()
    layers.crossPlants = [
      {
        blockId: 2 as BlockId,
        role: 'side',
        vertices: [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
        nx: 0,
        ny: 0,
        nz: 1,
        ao: 1,
      },
    ]
    layers.fluids = [
      {
        blockId: 3 as BlockId,
        direction: 'yPos',
        vertices: [
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 1],
          [0, 0, 1],
        ],
        ao: 3,
      },
    ]
    layers.specialBlocks = [
      {
        ...facePlacementOf('yNeg'),
        blockId: 4 as BlockId,
        kind: 'slab',
        nx: 0,
        ny: -1,
        nz: 0,
        vertices: [
          [0, 0, 1],
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
        ],
      },
    ]

    const result = packMeshLayers(layers)

    expect(Array.from(result.positions)).toStrictEqual([
      0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1,
      1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ])
    expect(Array.from(result.normals)).toStrictEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    ])
    expect(Array.from(result.blockIds)).toStrictEqual([
      2, 2, 2, 2,
      3, 3, 3, 3,
      4, 4, 4, 4,
    ])
    expect(Array.from(result.ambientOcclusion)).toStrictEqual([
      1, 1, 1, 1,
      3, 3, 3, 3,
      0, 0, 0, 0,
    ])
    expect(Array.from(result.indices)).toStrictEqual([
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11,
    ])
    expect(result.groups).toStrictEqual([
      {
        layer: 'opaque',
        vertexOffset: 0,
        vertexCount: 0,
        indexOffset: 0,
        indexCount: 0,
      },
      {
        layer: 'water',
        vertexOffset: 0,
        vertexCount: 0,
        indexOffset: 0,
        indexCount: 0,
      },
      {
        layer: 'transparentSolid',
        vertexOffset: 0,
        vertexCount: 0,
        indexOffset: 0,
        indexCount: 0,
      },
      {
        layer: 'crossPlants',
        vertexOffset: 0,
        vertexCount: 4,
        indexOffset: 0,
        indexCount: 6,
      },
      {
        layer: 'fluids',
        vertexOffset: 4,
        vertexCount: 4,
        indexOffset: 6,
        indexCount: 6,
      },
      {
        layer: 'specialBlocks',
        vertexOffset: 8,
        vertexCount: 4,
        indexOffset: 12,
        indexCount: 6,
      },
    ])
  })
})
