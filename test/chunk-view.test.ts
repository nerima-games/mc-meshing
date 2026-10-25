import { Option, Result } from 'effect'
import { ChunkAxis as chunkAxis, MAX_CHUNK_HEIGHT, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  blockCount,
  blockCountOf,
  blockIndex,
  emptyChunk,
  getBlock,
  validateChunkViews,
} from '../src/domain/chunk-view'

const STEP = 1
const CHUNK_X = chunkAxis(2)
const CHUNK_Z = chunkAxis(-1)
const STONE_X = 3
const STONE_Z = 5
const STONE_Y = 42
const invalidFixture = <T,>(value: any): T => value

describe('ChunkView', () => {
  it('keeps kernel coordinates alongside height-aware element storage', () => {
    const height = CHUNK_HEIGHT - STEP
    const blocks = new Uint16Array(Result.getOrThrow(blockCount(height)))
    const stone = Option.getOrThrow(blockIdOf('stone'))
    blocks[blockIndex(STONE_X, STONE_Y, STONE_Z, height)] = stone
    const view: ChunkView = { blocks, coord: chunkCoord(CHUNK_X, CHUNK_Z), height }

    expect(view.coord).toStrictEqual(chunkCoord(CHUNK_X, CHUNK_Z))
    expect(view.blocks).toHaveLength(CHUNK_SIZE * CHUNK_SIZE * height)
    expect(getBlock(view, STONE_X, STONE_Y, STONE_Z)).toBe(stone)
  })
})

describe('blockCount', () => {
  it('matches the default chunk storage size', () => {
    expect(blockCount(CHUNK_HEIGHT)).toStrictEqual(Result.succeed(BLOCKS_PER_CHUNK))
    expect(blockCountOf(CHUNK_HEIGHT)).toStrictEqual(Result.succeed(BLOCKS_PER_CHUNK))
    expect(Result.getOrThrow(emptyChunk()).blocks).toHaveLength(BLOCKS_PER_CHUNK)
  })

  it.each([
    ['a non-integer height', Number.NaN],
    ['a height below one', 0],
    ['a height above the kernel maximum', MAX_CHUNK_HEIGHT + STEP],
  ])('rejects %s', (_label, height) => {
    expect(blockCount(height)).toMatchObject({
      failure: { _tag: 'InvalidChunkHeight', height },
    })
  })

  it('rejects an invalid empty chunk height', () => {
    expect(emptyChunk(0)).toMatchObject({
      failure: { _tag: 'InvalidChunkHeight', height: 0 },
    })
  })
})

describe('validateChunkViews', () => {
  it('skips an undefined neighbour and rejects invalid heights on the core and loaded neighbours', () => {
    const valid = Result.getOrThrow(emptyChunk(CHUNK_HEIGHT))
    const undefinedNeighbour = invalidFixture<ChunkNeighbours>({ xPos: Reflect.get({}, 'xPos') })

    expect(Result.isSuccess(validateChunkViews(valid, undefinedNeighbour))).toBe(true)

    const invalidHeightChunk: ChunkView = { ...valid, height: 0 }
    expect(validateChunkViews(invalidHeightChunk, {})).toMatchObject({
      failure: { _tag: 'InvalidChunkHeight', height: 0 },
    })
    expect(validateChunkViews(valid, { xPos: invalidHeightChunk })).toMatchObject({
      failure: { _tag: 'InvalidChunkHeight', height: 0 },
    })
  })
})
