import { describe, expect, it } from '@effect/vitest'
import { blockIdOf, chunk, chunkCoord, type Chunk as KernelChunk } from '@nerima-games/mc-kernel'
import {
  AIR,
  CHUNK_SIZE,
  EMPTY_MESH_CONFIG,
  blockIndex,
  blocksPerChunk,
  getBlock,
  meshChunk,
  type ChunkView,
} from '../src/index'

const FIRST_INDEX = 0
const STEP = 1
const CHUNK_X = 2
const CHUNK_Z = -1
const STONE_X = 3
const STONE_Z = 5
const STONE_Y = 42
const STONE = blockIdOf('stone')

describe('mc-kernel chunk interoperability', () => {
  it('passes a kernel chunk directly to meshing without a copying adapter', () => {
    const height = 64
    const source = new Uint8Array(blocksPerChunk(height))
    source[blockIndex(STONE_X, STONE_Y, STONE_Z, height)] = STONE

    const kernelChunk = chunk(chunkCoord(CHUNK_X, CHUNK_Z), height, source)
    const view: ChunkView = kernelChunk
    const layers = meshChunk(kernelChunk, {}, EMPTY_MESH_CONFIG)

    expect(view.height).toBe(height)
    expect(view.blocks).toHaveLength(blocksPerChunk(height))
    expect(getBlock(kernelChunk, STONE_X, STONE_Y, STONE_Z)).toBe(STONE)
    expect(layers.opaque).toHaveLength(6)
  })

  it('preserves the kernel storage layout at both horizontal edges', () => {
    const height = 37
    const source = new Uint8Array(blocksPerChunk(height))
    source[blockIndex(FIRST_INDEX, FIRST_INDEX, FIRST_INDEX, height)] = STONE
    source[blockIndex(CHUNK_SIZE - STEP, height - STEP, CHUNK_SIZE - STEP, height)] = STONE

    const kernelChunk: KernelChunk = chunk(chunkCoord(FIRST_INDEX, FIRST_INDEX), height, source)

    expect(kernelChunk.blocks.get(blockIndex(FIRST_INDEX, FIRST_INDEX, FIRST_INDEX, height))).toBe(STONE)
    expect(kernelChunk.blocks.get(blockIndex(CHUNK_SIZE - STEP, height - STEP, CHUNK_SIZE - STEP, height))).toBe(STONE)
    expect(getBlock(kernelChunk, -STEP, FIRST_INDEX, FIRST_INDEX)).toBe(AIR)
    expect(getBlock(kernelChunk, FIRST_INDEX, height, FIRST_INDEX)).toBe(AIR)
  })
})
