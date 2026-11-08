import { Result } from 'effect'
import type { BlockId } from './block-data.js'
import {
  type ChunkBlockIndex,
  type ChunkView,
  blockStateAt,
} from './chunk-view.js'

type BlockStateResult = ReturnType<typeof blockStateAt>

export type MeshBlockStateReader = (blockId: BlockId, index: ChunkBlockIndex) => BlockStateResult

/** Cache states for one synchronous mesh operation so exposed faces do not decode the same cell repeatedly. */
export const meshBlockStateReaderFor = (chunk: ChunkView): MeshBlockStateReader => {
  if (typeof chunk.blockStates !== 'undefined') {
    const states = new Map<ChunkBlockIndex, BlockStateResult>()
    return (_blockId, index) => {
      const cached = states.get(index)
      if (typeof cached !== 'undefined') {
        return cached
      }
      const state = blockStateAt(chunk, index)
      states.set(index, state)
      return state
    }
  }

  const defaults = new Map<BlockId, BlockStateResult>()
  return (blockId, index) => {
    const cached = defaults.get(blockId)
    if (typeof cached !== 'undefined') {
      return cached
    }
    const state = blockStateAt(chunk, index)
    if (Result.isSuccess(state)) {
      defaults.set(blockId, state)
    }
    return state
  }
}
