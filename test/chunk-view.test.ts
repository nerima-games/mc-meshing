import { Option, Result, SchemaParser } from 'effect'
import * as FastCheck from 'fast-check'
import { vi } from 'vitest'
import {
  BlockId as KernelBlockId,
  ChunkAxis as chunkAxis,
  EffectiveBlockStateValuesSchema,
  MAX_CHUNK_HEIGHT,
  blockIdOf,
  chunkCoord,
  encodeBlockState,
} from '@nerima-games/mc-kernel'
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
  blockStateAt,
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
const STATE_CHUNK_HEIGHT = 8
const STATE_INDEX = blockIndex(2, 3, 4, STATE_CHUNK_HEIGHT)

type StatefulBlockType = 'water' | 'wheat_crop' | 'oak_log' | 'door_open'

const chunkWithRawBlockState = (blockType: StatefulBlockType, rawState?: number) => {
  const blockId = Option.getOrThrow(blockIdOf(blockType))
  const blocks = new Uint16Array(Result.getOrThrow(blockCount(STATE_CHUNK_HEIGHT)))
  blocks[STATE_INDEX] = blockId
  const base = { blocks, coord: chunkCoord(CHUNK_X, CHUNK_Z), height: STATE_CHUNK_HEIGHT }
  if (typeof rawState === 'undefined') {
    return { chunk: base, blockId, index: STATE_INDEX }
  }
  const blockStates = new Uint32Array(blocks.length)
  blockStates[STATE_INDEX] = rawState
  return { chunk: { ...base, blockStates }, blockId, index: STATE_INDEX }
}

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

  it('ignores enumerable properties outside the declared neighbour directions', () => {
    const valid = Result.getOrThrow(emptyChunk(CHUNK_HEIGHT))
    const invalidExtra = { ...valid, height: 0 }
    const neighbours = invalidFixture<ChunkNeighbours>({ unexpected: invalidExtra })

    expect(Result.isSuccess(validateChunkViews(valid, neighbours))).toBe(true)
  })
})

describe('blockStateAt', () => {
  it('reads kernel defaults when storage is omitted, including block-id-fixed properties', () => {
    const water = chunkWithRawBlockState('water')
    const waterState = Result.getOrThrow(blockStateAt(water.chunk, water.index))
    expect(waterState.level).toBe(0)

    const openDoor = chunkWithRawBlockState('door_open')
    const doorState = Result.getOrThrow(blockStateAt(openDoor.chunk, openDoor.index))
    expect(doorState.open).toBe(true)
  })

  it('uses neutral state for custom IDs with or without encoded state storage', () => {
    const customBlockId = Result.getOrThrow(KernelBlockId.result(300))
    const empty = Result.getOrThrow(emptyChunk(STATE_CHUNK_HEIGHT))
    const blocks = new Uint16Array(empty.blocks)
    blocks[STATE_INDEX] = customBlockId
    const chunk: ChunkView = { ...empty, blocks }

    expect(blockStateAt(chunk, STATE_INDEX)).toStrictEqual(Result.succeed({}))

    const blockStates = new Uint32Array(blocks.length)
    const chunkWithNeutralStates: ChunkView = { ...chunk, blockStates }
    for (const encoded of [0, 1]) {
      blockStates[STATE_INDEX] = encoded
      expect(blockStateAt(chunkWithNeutralStates, STATE_INDEX)).toStrictEqual(Result.succeed({}))
    }
  })

  it('returns a typed failure when a kernel default cannot be encoded', async () => {
    vi.resetModules()
    const waterId = Option.getOrThrow(blockIdOf('water'))
    const failure = { _tag: 'InjectedDefaultStateFailure', reason: 'invalid-property-value' }
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      const effectiveBlockStateOf: typeof kernel.effectiveBlockStateOf = (blockId, encoded) =>
        blockId === waterId
          ? invalidFixture(Result.fail(failure))
          : kernel.effectiveBlockStateOf(blockId, encoded)
      return {
        ...kernel,
        effectiveBlockStateOf,
      }
    })
    try {
      const { blockStateAt: readState } = await import('../src/domain/chunk-view.js')
      const { chunk, index } = chunkWithRawBlockState('water')
      expect(readState(chunk, index)).toStrictEqual(Result.fail({
        _tag: 'ChunkBlockStateCodecFailure',
        blockId: waterId,
        index,
        reason: 'invalid-property-value',
      }))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('decodes encoded water levels across the kernel state range and validates effective values', () => {
    const waterId = Option.getOrThrow(blockIdOf('water'))
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 15 }), (level) => {
        const encoded = encodeBlockState(waterId, { level })
        if (Result.isFailure(encoded)) {
          return false
        }
        const { chunk, index } = chunkWithRawBlockState('water', encoded.success)
        const state = blockStateAt(chunk, index)
        if (Result.isFailure(state)) {
          return false
        }
        const validated = SchemaParser.decodeUnknownResult(EffectiveBlockStateValuesSchema)(state.success)
        return Result.isSuccess(validated) && state.success.level === level
      }),
      { numRuns: 120 },
    )
  })

  it.each([
    ['minimum water level', 0, true],
    ['maximum water level', 15, true],
    ['one below the water range', -1, false],
    ['one above the water range', 16, false],
  ])('handles %s at the encoded fluid-level boundaries', (_label, level, valid) => {
    const waterId = Option.getOrThrow(blockIdOf('water'))
    const encoded = encodeBlockState(waterId, { level })
    if (!valid) {
      expect(encoded).toMatchObject({ failure: { _tag: 'BlockStateCodecFailure', reason: 'invalid-property-value' } })
      return
    }
    if (Result.isFailure(encoded)) {
      throw new Error('The kernel rejected a documented water-level boundary.')
    }
    const { chunk, index } = chunkWithRawBlockState('water', encoded.success)
    expect(blockStateAt(chunk, index)).toMatchObject({ success: { level } })
  })

  it.each([16, -1])('rejects reserved encoded water level %s with a typed codec failure', (rawState) => {
    const { chunk, blockId, index } = chunkWithRawBlockState('water', rawState)
    const encoded = rawState === -1 ? 0xffff_ffff : rawState
    expect(blockStateAt(chunk, index)).toStrictEqual(Result.fail({
      _tag: 'ChunkBlockStateCodecFailure',
      blockId,
      encoded,
      index,
      reason: 'reserved-code',
    }))
  })

  it('returns a typed failure for an index outside the chunk cell count', () => {
    const { chunk } = chunkWithRawBlockState('water', 0)
    const expected = chunk.blocks.length
    for (const index of [
      blockIndex(0, -1, 0, chunk.height),
      blockIndex(0, expected, 0, chunk.height),
      blockIndex(0, Number.NaN, 0, chunk.height),
      blockIndex(0, 0.5, 0, chunk.height),
    ]) {
      expect(blockStateAt(chunk, index)).toStrictEqual(Result.fail({
        _tag: 'ChunkBlockStateIndexOutOfRange',
        expected,
        index,
      }))
    }
  })

  it('rejects invalid chunk heights and block storage before decoding state', () => {
    const valid = Result.getOrThrow(emptyChunk(STATE_CHUNK_HEIGHT))
    const invalidHeight = invalidFixture<ChunkView>({ ...valid, height: 0 })
    expect(blockStateAt(invalidHeight, blockIndex(0, 0, 0, STATE_CHUNK_HEIGHT))).toMatchObject({
      failure: { _tag: 'InvalidChunkHeight', height: 0 },
    })

    const invalidBlocks: ChunkView = { ...valid, blocks: new Uint16Array(valid.blocks.length - 1) }
    expect(blockStateAt(invalidBlocks, blockIndex(0, 0, 0, STATE_CHUNK_HEIGHT))).toMatchObject({
      failure: {
        _tag: 'InvalidChunkBlocksLength',
        actual: valid.blocks.length - 1,
        coord: valid.coord,
        expected: valid.blocks.length,
      },
    })
  })

  it('rejects state storage with a length different from the chunk cell count', () => {
    const empty = Result.getOrThrow(emptyChunk(STATE_CHUNK_HEIGHT))
    const malformed: ChunkView = { ...empty, blockStates: new Uint32Array(1) }
    const validWithStates: ChunkView = { ...empty, blockStates: new Uint32Array(empty.blocks.length) }
    const failure = {
      _tag: 'InvalidChunkBlockStatesLength',
      actual: 1,
      coord: empty.coord,
      expected: empty.blocks.length,
    }

    expect(blockStateAt(malformed, blockIndex(0, 0, 0, malformed.height))).toMatchObject({ failure })
    expect(validateChunkViews(malformed, {})).toMatchObject({ failure })
    expect(Result.isSuccess(validateChunkViews(validWithStates, {}))).toBe(true)
    expect(Result.isSuccess(validateChunkViews(empty, {}))).toBe(true)
  })

  it('rejects state storage that is not a Uint32Array', () => {
    const empty = Result.getOrThrow(emptyChunk(STATE_CHUNK_HEIGHT))
    for (const blockStates of [null, new Uint8Array(empty.blocks.length)]) {
      const malformed: ChunkView = {
        ...empty,
        blockStates: invalidFixture<Readonly<Uint32Array>>(blockStates),
      }
      const failure = { _tag: 'InvalidChunkBlockStatesType', coord: empty.coord }
      expect(blockStateAt(malformed, STATE_INDEX)).toMatchObject({ failure })
      expect(validateChunkViews(malformed, {})).toMatchObject({ failure })
    }
  })

  it('rejects Uint32Array proxies that do not return an encoded value at a valid index', () => {
    const empty = Result.getOrThrow(emptyChunk(STATE_CHUNK_HEIGHT))
    const blockStates = new Proxy(new Uint32Array(empty.blocks.length), {
      get(target, property) {
        if (property === String(STATE_INDEX)) {
          return Reflect.get({}, 'missing')
        }
        return Reflect.get(target, property, target)
      },
    })
    const malformed: ChunkView = { ...empty, blockStates }

    expect(blockStateAt(malformed, STATE_INDEX)).toStrictEqual(Result.fail({
      _tag: 'InvalidChunkBlockStatesType',
      coord: empty.coord,
    }))
  })
})
