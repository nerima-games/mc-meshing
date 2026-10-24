import { Result } from 'effect'
import { BlockId as KernelBlockId, BLOCK_ID_MAX } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity.js'
import { buildFluidLookup, isFluidBlock, maxLevelOf } from '../src/domain/fluid-sampling.js'

const BLOCK_ID = Result.getOrThrow(KernelBlockId.result(1))
const MISSING_BLOCK_ID = Result.getOrThrow(KernelBlockId.result(5))

describe('maxLevelOf', () => {
  it('rejects a block id with no entry in the fluid lookup table', () => {
    const lookup = new Uint16Array(BLOCK_ID_MAX + 1)
    lookup[BLOCK_ID] = 8
    expect(maxLevelOf(lookup, BLOCK_ID)).toStrictEqual(Result.succeed(7))
    expect(maxLevelOf(lookup, MISSING_BLOCK_ID)).toMatchObject({
      failure: { _tag: 'MissingFluidLookupEntry', blockId: MISSING_BLOCK_ID },
    })
  })

  it('rejects a table with a different size from the complete block-id domain', () => {
    expect(maxLevelOf(new Uint16Array([0, 8]), BLOCK_ID)).toMatchObject({
      failure: { _tag: 'InvalidFluidLookupLength', actual: 2, expected: BLOCK_ID_MAX + 1 },
    })
  })

  it('builds the full lookup and reads the maximum encoded level for the highest block id', () => {
    const blockId = Result.getOrThrow(KernelBlockId.result(BLOCK_ID_MAX))
    const config = {
      ...EMPTY_MESH_CONFIG,
      fluidMaxLevels: new Map([[blockId, 255]]),
    }
    const lookup = Result.getOrThrow(buildFluidLookup(config))

    expect(lookup).toHaveLength(BLOCK_ID_MAX + 1)
    expect(isFluidBlock(lookup, blockId)).toBe(true)
    expect(maxLevelOf(lookup, blockId)).toStrictEqual(Result.succeed(255))
  })

  it('reports an invalid fluid max level without throwing', () => {
    const config = {
      ...EMPTY_MESH_CONFIG,
      fluidMaxLevels: new Map([[BLOCK_ID, 256]]),
    }

    expect(buildFluidLookup(config)).toMatchObject({
      failure: { _tag: 'InvalidFluidMaxLevel', blockId: BLOCK_ID, maxLevel: 256 },
    })
  })
})
