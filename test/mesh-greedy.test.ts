import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import { AO_MAX } from '../src/domain/ambient-occlusion.js'
import { MAX_BLOCK_ID } from '../src/domain/block-data.js'
import { faceCellAo, faceCellBlockId, maskCellAt, packFaceCell } from '../src/domain/mesh-greedy.js'

describe('maskCellAt', () => {
  it('rejects a mask index outside the mask array', () => {
    const mask = new Uint32Array([0, 5, 9])
    expect(maskCellAt(mask, 1)).toStrictEqual(Result.succeed(5))
    expect(maskCellAt(mask, 3)).toStrictEqual(
      Result.fail({ _tag: 'GreedyMaskIndexOutOfRange', index: 3 }),
    )
  })
})

describe('packed face cells', () => {
  it('keeps the full 16-bit block id below ambient-occlusion bits', () => {
    const mask = new Uint32Array([packFaceCell(MAX_BLOCK_ID, AO_MAX)])
    const packed = Result.getOrThrow(maskCellAt(mask, 0))

    expect(faceCellBlockId(packed)).toBe(MAX_BLOCK_ID)
    expect(faceCellAo(packed)).toBe(AO_MAX)
  })
})
