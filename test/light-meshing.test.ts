import { describe, expect, it } from 'vitest'
import {
  AIR_BLOCK_ID,
  BLOCK_IDS,
  propertyOfBlockId,
  type BlockId,
} from '@nerima-games/mc-kernel'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  blockIndex,
  type ChunkView,
} from '../src/domain/chunk-view'
import { quadLightAt, sampleLightAt } from '../src/domain/light-sampling'
import type { LightView } from '../src/domain/light-types'
import { meshChunk, meshChunkNaive, meshChunkRegion } from '../src/domain/mesh'
import { packMeshLayers } from '../src/domain/mesh-buffers'
import { MINECRAFT_MESH_CONFIG } from '../src/domain/opacity'
import { facePlacementOf } from '../src/domain/faces'

const MISSING_BLOCK_ID = -1

const firstBlockId = (renderKind: 'cube' | 'cross' | 'fluid' | 'rail'): BlockId => {
  const blockId = BLOCK_IDS.find(
    (candidate) => candidate !== AIR_BLOCK_ID && propertyOfBlockId(candidate, 'renderKind') === renderKind,
  ) ?? MISSING_BLOCK_ID
  if (blockId === MISSING_BLOCK_ID) {
    throw new Error(`mc-kernel has no ${renderKind} block`)
  }
  return blockId
}

const OPAQUE_CUBE = firstBlockId('cube')

const lightOf = (block: number, sky: number): LightView => ({
  blockLight: new Uint8Array(BLOCKS_PER_CHUNK).fill(block),
  skyLight: new Uint8Array(BLOCKS_PER_CHUNK).fill(sky),
})

const chunkWith = (
  cells: ReadonlyArray<readonly [number, number, number, number]>,
  light?: LightView,
): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [x, y, z, blockId] of cells) {
    blocks[blockIndex(x, y, z, CHUNK_HEIGHT)] = blockId
  }
  const chunk = { blocks, height: CHUNK_HEIGHT }
  if (light) {
    return { ...chunk, light }
  }
  return chunk
}

const yPosQuads = (chunk: ChunkView) =>
  meshChunk(chunk, {}, MINECRAFT_MESH_CONFIG).opaque.filter((quad) => quad.direction === 'yPos')

describe('injected Minecraft light data', () => {
  it('samples an adjacent chunk for a quad corner at the horizontal seam', () => {
    const chunk = chunkWith([], lightOf(2, 3))
    const xPos = chunkWith([], lightOf(7, 11))

    expect(quadLightAt(chunk, { xPos }, 'yPos', CHUNK_SIZE - 1, 20, 4)).toStrictEqual({
      block: [2, 2, 7, 7],
      sky: [3, 3, 11, 11],
    })
  })

  it('samples every horizontal neighbour and diagonal seam', () => {
    const chunk = chunkWith([], lightOf(1, 2))
    const neighbours = {
      xNeg: chunkWith([], lightOf(3, 4)),
      xPos: chunkWith([], lightOf(5, 6)),
      zNeg: chunkWith([], lightOf(7, 8)),
      zPos: chunkWith([], lightOf(9, 10)),
      xNegZNeg: chunkWith([], lightOf(11, 12)),
      xNegZPos: chunkWith([], lightOf(13, 14)),
      xPosZNeg: chunkWith([], lightOf(15, 1)),
      xPosZPos: chunkWith([], lightOf(4, 6)),
    }

    expect(sampleLightAt(chunk, neighbours, -1, 0, 4)).toStrictEqual({ block: 3, sky: 4 })
    expect(sampleLightAt(chunk, neighbours, CHUNK_SIZE, 0, 4)).toStrictEqual({ block: 5, sky: 6 })
    expect(sampleLightAt(chunk, neighbours, 4, 0, -1)).toStrictEqual({ block: 7, sky: 8 })
    expect(sampleLightAt(chunk, neighbours, 4, 0, CHUNK_SIZE)).toStrictEqual({ block: 9, sky: 10 })
    expect(sampleLightAt(chunk, neighbours, -1, 0, -1)).toStrictEqual({ block: 11, sky: 12 })
    expect(sampleLightAt(chunk, neighbours, -1, 0, CHUNK_SIZE)).toStrictEqual({ block: 13, sky: 14 })
    expect(sampleLightAt(chunk, neighbours, CHUNK_SIZE, 0, -1)).toStrictEqual({ block: 15, sky: 1 })
    expect(sampleLightAt(chunk, neighbours, CHUNK_SIZE, 0, CHUNK_SIZE)).toStrictEqual({ block: 4, sky: 6 })
  })

  it('uses explicit defaults for unloaded, unlit, short, and invalid samples', () => {
    const lit = chunkWith([], lightOf(4, 5))
    const unlit = chunkWith([])
    const emptyLight = chunkWith([], { blockLight: new Uint8Array(), skyLight: new Uint8Array() })

    expect(sampleLightAt(lit, {}, -1, 0, 0)).toStrictEqual({ block: 0, sky: 15 })
    expect(sampleLightAt(lit, { xPos: unlit }, CHUNK_SIZE, 0, 0)).toStrictEqual({ block: 0, sky: 15 })
    expect(sampleLightAt(unlit, {}, 0, 0, 0)).toStrictEqual({ block: 0, sky: 15 })
    expect(sampleLightAt(emptyLight, {}, 0, 0, 0)).toStrictEqual({ block: 0, sky: 15 })
    expect(sampleLightAt(lit, {}, 0, CHUNK_HEIGHT, 0)).toStrictEqual({ block: 0, sky: 15 })
    expect(sampleLightAt(lit, {}, 0, -1, 0)).toStrictEqual({ block: 0, sky: 0 })
  })

  it('carries corner light through greedy, naive, and region meshes', () => {
    const chunk = chunkWith([[4, 20, 5, OPAQUE_CUBE]], lightOf(7, 13))
    const greedy = meshChunk(chunk, {}, MINECRAFT_MESH_CONFIG)
    const naive = meshChunkNaive(chunk, {}, MINECRAFT_MESH_CONFIG)
    const regional = meshChunkRegion(chunk, {}, MINECRAFT_MESH_CONFIG, {
      min: [4, 20, 5],
      max: [5, 21, 6],
    })

    expect(greedy.opaque).toHaveLength(6)
    expect(greedy.opaque.every((quad) => quad.light?.block.every((value) => value === 7))).toBe(true)
    expect(greedy.opaque.every((quad) => quad.light?.sky.every((value) => value === 13))).toBe(true)
    expect(greedy).toStrictEqual(naive)
    expect(regional.layers.opaque).toStrictEqual(naive.opaque)
  })

  it('keeps differently lit adjacent faces out of the same greedy rectangle', () => {
    const uniform = chunkWith(
      [[2, 20, 4, OPAQUE_CUBE], [3, 20, 4, OPAQUE_CUBE]],
      lightOf(9, 13),
    )
    const varyingBlockLight = new Uint8Array(BLOCKS_PER_CHUNK).fill(9)
    const varyingLight: LightView = {
      blockLight: varyingBlockLight,
      skyLight: new Uint8Array(BLOCKS_PER_CHUNK).fill(13),
    }
    for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        varyingBlockLight[blockIndex(2, y, z, CHUNK_HEIGHT)] = 2
      }
    }
    const varied = chunkWith(
      [[2, 20, 4, OPAQUE_CUBE], [3, 20, 4, OPAQUE_CUBE]],
      varyingLight,
    )

    expect(yPosQuads(uniform)).toHaveLength(1)
    expect(yPosQuads(varied)).toHaveLength(2)
    expect(yPosQuads(varied).map((quad) => quad.light?.block)).toContainEqual([2, 2, 9, 9])
  })

  it('stops an inner greedy run when corner light changes', () => {
    const varyingBlockLight = new Uint8Array(BLOCKS_PER_CHUNK).fill(9)
    varyingBlockLight[blockIndex(2, 20, 7, CHUNK_HEIGHT)] = 2
    const varyingSkyLight = new Uint8Array(BLOCKS_PER_CHUNK).fill(13)
    varyingSkyLight[blockIndex(2, 20, 4, CHUNK_HEIGHT)] = 12
    const chunk = chunkWith(
      [
        [2, 20, 4, OPAQUE_CUBE],
        [2, 20, 5, OPAQUE_CUBE],
        [2, 20, 6, OPAQUE_CUBE],
      ],
      { blockLight: varyingBlockLight, skyLight: varyingSkyLight },
    )

    expect(yPosQuads(chunk)).toHaveLength(3)
  })

  it('keeps light on transparent-solid greedy faces', () => {
    const config = {
      ...MINECRAFT_MESH_CONFIG,
      transparentSolidBlockIds: new Set([OPAQUE_CUBE]),
    }
    const layers = meshChunk(chunkWith([[4, 20, 4, OPAQUE_CUBE]], lightOf(6, 10)), {}, config)

    expect(layers.transparentSolid).toHaveLength(6)
    expect(layers.transparentSolid.every((quad) => quad.light?.block.every((value) => value === 6))).toBe(true)
    expect(layers.transparentSolid.every((quad) => quad.light?.sky.every((value) => value === 10))).toBe(true)
  })

  it('packs light channels for cube and explicit geometry into vertex buffers', () => {
    const layers = {
      crossPlants: [],
      fluids: [],
      opaque: [{
        ...facePlacementOf('yPos'),
        ao: 0,
        blockId: OPAQUE_CUBE,
        height: 1,
        light: { block: [1, 2, 3, 4] as const, sky: [11, 12, 13, 14] as const },
        lx: 0,
        lz: 0,
        width: 1,
        y: 0,
      }],
      specialBlocks: [],
      transparentSolid: [],
      water: [],
    } as const
    const buffers = packMeshLayers(layers)

    expect(Array.from(buffers.blockLight)).toEqual([1, 2, 3, 4])
    expect(Array.from(buffers.skyLight)).toEqual([11, 12, 13, 14])
  })

  it('carries corner light into plants, fluids, and kernel-special geometry', () => {
    const chunk = chunkWith([
      [2, 20, 2, firstBlockId('cross')],
      [6, 20, 6, firstBlockId('fluid')],
      [10, 20, 10, firstBlockId('rail')],
    ], lightOf(5, 12))
    const layers = meshChunk(chunk, {}, MINECRAFT_MESH_CONFIG)
    const explicitQuads = [
      ...layers.crossPlants,
      ...layers.fluids,
      ...layers.specialBlocks,
    ]

    expect(explicitQuads.length).toBeGreaterThan(0)
    expect(explicitQuads.every((quad) => quad.light?.block.every((value) => value === 5))).toBe(true)
    expect(explicitQuads.every((quad) => quad.light?.sky.every((value) => value === 12))).toBe(true)
  })
})
