import { Option, Result } from 'effect'
import { vi } from 'vitest'
import { blockIdOf, encodeBlockState } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'
import { blockIndex, emptyChunk, type ChunkView } from '../src/domain/chunk-view.js'

const HEIGHT = 8
const FIRST_INDEX = blockIndex(1, 2, 3, HEIGHT)
const SECOND_INDEX = blockIndex(2, 2, 3, HEIGHT)
const invalidFixture = <T,>(value: any): T => value

describe('mesh block state reader', () => {
  it('reuses kernel defaults across cells with the same ID when state storage is omitted', async () => {
    const { meshBlockStateReaderFor: makeReader } = await import('../src/domain/mesh-state-reader.js')
    const water = Option.getOrThrow(blockIdOf('water'))
    const empty = Result.getOrThrow(emptyChunk(HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[FIRST_INDEX] = water
    blocks[SECOND_INDEX] = water
    const chunk: ChunkView = { ...empty, blocks }
    const read = makeReader(chunk)
    const first = read(water, FIRST_INDEX)

    expect(first).toMatchObject({ success: { level: 0 } })
    expect(read(water, SECOND_INDEX)).toBe(first)
  })

  it('preserves default-state failures at each cell index instead of caching them', async () => {
    vi.resetModules()
    const water = Option.getOrThrow(blockIdOf('water'))
    const failure = { _tag: 'InjectedDefaultStateFailure', reason: 'invalid-property-value' }
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      const effectiveBlockStateOf: typeof kernel.effectiveBlockStateOf = (blockId, encoded) =>
        blockId === water
          ? invalidFixture(Result.fail(failure))
          : kernel.effectiveBlockStateOf(blockId, encoded)
      return { ...kernel, effectiveBlockStateOf }
    })
    try {
      const { meshBlockStateReaderFor: makeReader } = await import('../src/domain/mesh-state-reader.js')
      const empty = Result.getOrThrow(emptyChunk(HEIGHT))
      const blocks = new Uint16Array(empty.blocks)
      blocks[FIRST_INDEX] = water
      blocks[SECOND_INDEX] = water
      const chunk: ChunkView = { ...empty, blocks }
      const read = makeReader(chunk)

      const first = read(water, FIRST_INDEX)
      const second = read(water, SECOND_INDEX)

      expect(first).toStrictEqual(Result.fail({
        _tag: 'ChunkBlockStateCodecFailure',
        blockId: water,
        index: FIRST_INDEX,
        reason: 'invalid-property-value',
      }))
      expect(second).toStrictEqual(Result.fail({
        _tag: 'ChunkBlockStateCodecFailure',
        blockId: water,
        index: SECOND_INDEX,
        reason: 'invalid-property-value',
      }))
      expect(second).not.toBe(first)
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('decodes each stored cell state once and keeps different cell states distinct', async () => {
    const { meshBlockStateReaderFor: makeReader } = await import('../src/domain/mesh-state-reader.js')
    const water = Option.getOrThrow(blockIdOf('water'))
    const empty = Result.getOrThrow(emptyChunk(HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[FIRST_INDEX] = water
    blocks[SECOND_INDEX] = water
    const blockStates = new Uint32Array(blocks.length)
    blockStates[FIRST_INDEX] = Result.getOrThrow(encodeBlockState(water, { level: 0 }))
    blockStates[SECOND_INDEX] = Result.getOrThrow(encodeBlockState(water, { level: 1 }))
    const chunk: ChunkView = { ...empty, blocks, blockStates }
    const read = makeReader(chunk)

    const first = read(water, FIRST_INDEX)
    expect(first).toMatchObject({ success: { level: 0 } })
    expect(read(water, FIRST_INDEX)).toBe(first)
    expect(read(water, SECOND_INDEX)).toMatchObject({ success: { level: 1 } })
  })

  it('keeps indexed codec failures typed and repeatable', async () => {
    const { meshBlockStateReaderFor: makeReader } = await import('../src/domain/mesh-state-reader.js')
    const water = Option.getOrThrow(blockIdOf('water'))
    const empty = Result.getOrThrow(emptyChunk(HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[FIRST_INDEX] = water
    const blockStates = new Uint32Array(blocks.length)
    blockStates[FIRST_INDEX] = 0xffff_ffff
    const chunk: ChunkView = { ...empty, blocks, blockStates }
    const read = makeReader(chunk)
    const failure = read(water, FIRST_INDEX)

    expect(failure).toMatchObject({
      failure: { _tag: 'ChunkBlockStateCodecFailure', blockId: water, index: FIRST_INDEX, encoded: 0xffff_ffff },
    })
    expect(read(water, FIRST_INDEX)).toBe(failure)
  })
})
