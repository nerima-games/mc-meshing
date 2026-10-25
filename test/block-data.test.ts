import { Option, Result } from 'effect'
import { BlockId as KernelBlockId, BLOCK_ID_MAX } from '@nerima-games/mc-kernel'
import { describe, expect, it, vi } from 'vitest'
import { AIR, blockIdAt } from '../src/domain/block-data.js'

const importBlockDataWithRegistry = async (
  blockIds: ReadonlyArray<number>,
  propertyOfBlockId: (blockId: number, property: string) => unknown,
) => {
  vi.resetModules()
  vi.doMock('@nerima-games/mc-kernel', () => ({
    AIR_BLOCK_ID: 0,
    BLOCK_ID_MAX: 0xffff,
    BLOCK_IDS: blockIds,
    blockIdsWithOpacity: () => Result.succeed(Option.some(new Set())),
    propertyOfBlockId,
  }))
  try {
    return await import('../src/domain/block-data.js')
  } finally {
    vi.doUnmock('@nerima-games/mc-kernel')
    vi.resetModules()
  }
}

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

  it('maps registered fluid kinds to their propagation ceilings', async () => {
    const blockData = await importBlockDataWithRegistry([1, 2, 3], (blockId, property) => {
      if (property === 'renderKind') {
        return Result.succeed(blockId === 3 ? 'cube' : 'fluid')
      }
      return Result.succeed(blockId === 1 ? 'water' : blockId === 2 ? 'lava' : new Map<string, unknown>().get('missing'))
    })

    expect(blockData.MINECRAFT_FLUID_MAX_LEVELS).toStrictEqual(
      Result.succeed(new Map([[1, 7], [2, 3]])),
    )
    expect(blockData.MINECRAFT_WATER_BLOCK_IDS).toStrictEqual(Result.succeed(new Set([1])))
  })

  it('propagates block-property resolution failures from registry scans', async () => {
    const failure = { _tag: 'TestRegistryFailure' }
    const blockData = await importBlockDataWithRegistry([1], () => Result.fail(failure))

    expect(blockData.MINECRAFT_WATER_BLOCK_IDS).toStrictEqual(Result.fail(failure))
    expect(blockData.MINECRAFT_CROSS_PLANT_BLOCK_IDS).toStrictEqual(Result.fail(failure))
    expect(blockData.MINECRAFT_FLUID_MAX_LEVELS).toStrictEqual(Result.fail(failure))
  })

  it('rejects fluid-renderable blocks whose registry omits fluid kind', async () => {
    const blockData = await importBlockDataWithRegistry([1], (_blockId, property) =>
      property === 'renderKind' ? Result.succeed('fluid') : Result.succeed(new Map<string, unknown>().get('missing')),
    )

    expect(blockData.MINECRAFT_FLUID_MAX_LEVELS).toStrictEqual(
      Result.fail({
        _tag: 'MissingFluidKind',
        blockId: 1,
      }),
    )
  })

  it('propagates fluid-kind resolution failures for fluid-renderable blocks', async () => {
    const failure = { _tag: 'TestRegistryFailure' }
    const blockData = await importBlockDataWithRegistry([1], (_blockId, property) =>
      property === 'renderKind' ? Result.succeed('fluid') : Result.fail(failure),
    )

    expect(blockData.MINECRAFT_FLUID_MAX_LEVELS).toStrictEqual(Result.fail(failure))
  })
})
