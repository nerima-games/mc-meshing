import { MAX_CHUNK_HEIGHT, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkView,
  blockCount,
  blockCountOf,
  blockIndex,
  getBlock,
} from '../src/domain/chunk-view'

const STEP = 1
const CHUNK_X = 2
const CHUNK_Z = -1
const STONE_X = 3
const STONE_Z = 5
const STONE_Y = 42

describe('ChunkView', () => {
  it('keeps kernel coordinates alongside height-aware byte storage', () => {
    const height = CHUNK_HEIGHT - STEP
    const blocks = new Uint8Array(blockCount(height))
    const stone = blockIdOf('stone')
    blocks[blockIndex(STONE_X, STONE_Y, STONE_Z, height)] = stone
    const view: ChunkView = { blocks, coord: chunkCoord(CHUNK_X, CHUNK_Z), height }

    expect(view.coord).toStrictEqual(chunkCoord(CHUNK_X, CHUNK_Z))
    expect(view.blocks).toHaveLength(CHUNK_SIZE * CHUNK_SIZE * height)
    expect(getBlock(view, STONE_X, STONE_Y, STONE_Z)).toBe(stone)
  })
})

describe('blockCount', () => {
  it('matches the default chunk storage size', () => {
    expect(blockCount(CHUNK_HEIGHT)).toBe(BLOCKS_PER_CHUNK)
    expect(blockCountOf(CHUNK_HEIGHT)).toBe(BLOCKS_PER_CHUNK)
  })

  it.each([
    ['a non-integer height', Number.NaN],
    ['a height below one', 0],
    ['a height above the kernel maximum', MAX_CHUNK_HEIGHT + STEP],
  ])('rejects %s', (_label, height) => {
    expect(() => blockCount(height)).toThrow(RangeError)
  })
})
