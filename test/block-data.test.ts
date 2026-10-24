import { BlockId as KernelBlockId, BLOCK_ID_MAX } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import { AIR, blockIdAt } from '../src/domain/block-data.js'

describe('block data ids', () => {
  it('reads the full Uint16 range as valid kernel block ids', () => {
    const blocks = new Uint16Array([BLOCK_ID_MAX])
    const blockId = blockIdAt(blocks, 0)

    expect(blockId).toBe(BLOCK_ID_MAX)
    expect(KernelBlockId.is(blockId)).toBe(true)
  })

  it('returns air for an index outside the typed storage', () => {
    expect(blockIdAt(new Uint16Array(), 0)).toBe(AIR)
  })
})
