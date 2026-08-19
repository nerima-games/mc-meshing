/* oxlint-disable sort-imports */
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, CHUNK_SIZE, blockCountOf, blockIndex } from '../src/domain/chunk-view'
import { chunkViewOf } from '../src/domain/kernel-adapter'
import { MAX_CHUNK_HEIGHT, blockIdOf, chunk, chunkCoord } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'

const FIRST_INDEX = 0
const STEP = 1
const SECOND_CHUNK_X = 2
const NEGATIVE_CHUNK_Z = -1
const STONE_X = 3
const STONE_Z = 5
const STONE_Y = 42
const EDGE_X = CHUNK_SIZE - STEP
const EDGE_Z = FIRST_INDEX
const EDGE_Y = CHUNK_HEIGHT - STEP

describe('chunkViewOf', () => {
  it('preserves kernel column storage in the meshing layout', () => {
    const source = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT)
    const stone = blockIdOf('stone')
    source[(STONE_X * CHUNK_SIZE + STONE_Z) * CHUNK_HEIGHT + STONE_Y] = stone
    source[(EDGE_X * CHUNK_SIZE + EDGE_Z) * CHUNK_HEIGHT + EDGE_Y] = stone

    const view = chunkViewOf(chunk(chunkCoord(SECOND_CHUNK_X, NEGATIVE_CHUNK_Z), CHUNK_HEIGHT, source))

    expect(view.height).toBe(CHUNK_HEIGHT)
    expect(view.blocks).toHaveLength(BLOCKS_PER_CHUNK)
    expect(view.blocks[blockIndex(STONE_X, STONE_Y, STONE_Z, CHUNK_HEIGHT)]).toBe(stone)
    expect(view.blocks[blockIndex(EDGE_X, EDGE_Y, EDGE_Z, CHUNK_HEIGHT)]).toBe(stone)
    expect(view.blocks[blockIndex(FIRST_INDEX, FIRST_INDEX, FIRST_INDEX, CHUNK_HEIGHT)]).toBe(FIRST_INDEX)
  })

  it('preserves a kernel chunk with a non-default height', () => {
    const height = CHUNK_HEIGHT - STEP
    const sourceBlocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * height)
    const stone = blockIdOf('stone')
    sourceBlocks[(STONE_X * CHUNK_SIZE + STONE_Z) * height + STONE_Y] = stone
    const source = chunk(chunkCoord(FIRST_INDEX, FIRST_INDEX), height, sourceBlocks)

    const view = chunkViewOf(source)

    expect(view.height).toBe(height)
    expect(view.blocks).toHaveLength(CHUNK_SIZE * CHUNK_SIZE * height)
    expect(view.blocks[blockIndex(STONE_X, STONE_Y, STONE_Z, height)]).toBe(stone)
  })

})

describe('blockCountOf', () => {
  it.each([
    ['a non-integer height', Number.NaN],
    ['a height below one', 0],
    ['a height above the kernel maximum', MAX_CHUNK_HEIGHT + STEP],
  ])('rejects %s', (_label, height) => {
    expect(() => blockCountOf(height)).toThrow(RangeError)
  })
})
