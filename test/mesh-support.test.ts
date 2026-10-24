import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import { BlockId as KernelBlockId } from '@nerima-games/mc-kernel'
import { MAX_BLOCK_ID, type BlockId } from '../src/domain/block-data.js'
import { layerAt, layerLookupFromTable } from '../src/domain/mesh-support.js'

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const blockId = (value: number): BlockId => expectSuccess(KernelBlockId.result(value))

describe('layerAt', () => {
  it('reads a known layer from the validated full lookup table', () => {
    const table = new Uint8Array(MAX_BLOCK_ID + 1)
    table[5] = 1
    const lookup = expectSuccess(layerLookupFromTable(table))
    expect(layerAt(lookup, blockId(5))).toBe(1)
  })

  it('rejects incomplete tables and invalid layer entries at construction', () => {
    expect(layerLookupFromTable(new Uint8Array([0, 1, 2]))).toStrictEqual(
      Result.fail({ _tag: 'InvalidLayerLookupLength', actual: 3, expected: MAX_BLOCK_ID + 1 }),
    )

    const table = new Uint8Array(MAX_BLOCK_ID + 1)
    table[7] = 3
    expect(layerLookupFromTable(table)).toStrictEqual(
      Result.fail({ _tag: 'InvalidLayerLookupEntry', blockId: 7, layer: 3 }),
    )
  })
})
