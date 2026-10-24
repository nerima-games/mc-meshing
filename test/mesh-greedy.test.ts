import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import { AO_MAX } from '../src/domain/ambient-occlusion.js'
import { MAX_BLOCK_ID } from '../src/domain/block-data.js'
import { emptyChunk } from '../src/domain/chunk-view.js'
import { faceCellAo, faceCellBlockId, maskCellAt, meshAllFaces, packFaceCell } from '../src/domain/mesh-greedy.js'
import { layerLookupFromTable } from '../src/domain/mesh-support.js'
import { SPECIAL_BLOCK_LOOKUP } from '../src/domain/special-mesh.js'

describe('maskCellAt', () => {
  it('rejects a mask index outside the mask array', () => {
    const mask = new Uint32Array([0, 5, 9])
    expect(maskCellAt(mask, 1)).toStrictEqual(Result.succeed(5))
    expect(maskCellAt(mask, 3)).toStrictEqual(
      Result.fail({ _tag: 'GreedyMaskIndexOutOfRange', index: 3 }),
    )
  })
})

describe('greedy face expansion', () => {
  it('returns the first out-of-range mask index instead of expanding from a short work buffer', () => {
    const result = meshAllFaces({
      chunk: Result.getOrThrow(emptyChunk(2)),
      fluids: new Uint16Array(MAX_BLOCK_ID + 1),
      lookup: Result.getOrThrow(layerLookupFromTable(new Uint8Array(MAX_BLOCK_ID + 1))),
      light: { block: new Uint16Array(1), sky: new Uint16Array(1) },
      mask: new Uint32Array(1),
      neighbours: {},
      plants: new Uint8Array(MAX_BLOCK_ID + 1),
      specialLookup: Result.getOrThrow(SPECIAL_BLOCK_LOOKUP),
      push: (quad) => quad,
      yLimit: 2,
    })

    expect(result).toStrictEqual(Result.fail({ _tag: 'GreedyMaskIndexOutOfRange', index: 1 }))
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
