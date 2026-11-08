import { Option, Result } from 'effect'
import { blockIdOf, encodeBlockState } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'
import { blockIndex, emptyChunk, type ChunkView } from '../src/domain/chunk-view.js'
import { meshBlockStateReaderFor } from '../src/domain/mesh-state-reader.js'

const HEIGHT = 8
const FIRST_INDEX = blockIndex(1, 2, 3, HEIGHT)
const SECOND_INDEX = blockIndex(2, 2, 3, HEIGHT)

describe('mesh block state reader', () => {
  it('reuses kernel defaults across cells with the same ID when state storage is omitted', () => {
    const water = Option.getOrThrow(blockIdOf('water'))
    const empty = Result.getOrThrow(emptyChunk(HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[FIRST_INDEX] = water
    blocks[SECOND_INDEX] = water
    const chunk: ChunkView = { ...empty, blocks }
    const read = meshBlockStateReaderFor(chunk)
    const first = read(water, FIRST_INDEX)

    expect(first).toMatchObject({ success: { level: 0 } })
    expect(read(water, SECOND_INDEX)).toBe(first)
  })

  it('decodes each stored cell state once and keeps different cell states distinct', () => {
    const water = Option.getOrThrow(blockIdOf('water'))
    const empty = Result.getOrThrow(emptyChunk(HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[FIRST_INDEX] = water
    blocks[SECOND_INDEX] = water
    const blockStates = new Uint32Array(blocks.length)
    blockStates[FIRST_INDEX] = Result.getOrThrow(encodeBlockState(water, { level: 0 }))
    blockStates[SECOND_INDEX] = Result.getOrThrow(encodeBlockState(water, { level: 1 }))
    const read = meshBlockStateReaderFor({ ...empty, blocks, blockStates })
    const first = read(water, FIRST_INDEX)

    expect(first).toMatchObject({ success: { level: 0 } })
    expect(read(water, FIRST_INDEX)).toBe(first)
    expect(read(water, SECOND_INDEX)).toMatchObject({ success: { level: 1 } })
  })

  it('keeps indexed codec failures typed and repeatable', () => {
    const water = Option.getOrThrow(blockIdOf('water'))
    const empty = Result.getOrThrow(emptyChunk(HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[FIRST_INDEX] = water
    const blockStates = new Uint32Array(blocks.length)
    blockStates[FIRST_INDEX] = 0xffff_ffff
    const read = meshBlockStateReaderFor({ ...empty, blocks, blockStates })
    const failure = read(water, FIRST_INDEX)

    expect(failure).toMatchObject({
      failure: { _tag: 'ChunkBlockStateCodecFailure', blockId: water, index: FIRST_INDEX, encoded: 0xffff_ffff },
    })
    expect(read(water, FIRST_INDEX)).toBe(failure)
  })
})
