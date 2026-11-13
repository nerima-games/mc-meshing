import * as FastCheck from 'fast-check'
import { Option, Result } from 'effect'
import {
  BlockId as KernelBlockId,
  BLOCK_IDS,
  BLOCK_ID_MAX,
  FLOWING_FLUID_LEVEL,
  FLUID_LEVEL_STEP,
  blockIdOf,
  blockTypeOfId,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { describe, expect, it, vi } from 'vitest'
import { AIR, blockIdAt, MINECRAFT_CROSS_PLANT_BLOCK_IDS, MINECRAFT_FLUID_MAX_LEVELS } from '../src/domain/block-data.js'
import { classifyVanillaBlockType } from '../src/domain/vanilla-block-model.js'

const OVERWORLD_LAVA_LEVEL_INCREMENT = 2
const flowingLevelOffsets = Array.from(
  { length: Math.floor(FLOWING_FLUID_LEVEL / FLUID_LEVEL_STEP) + 1 },
  (_, index) => index * FLUID_LEVEL_STEP,
)
const expectedWaterMaxLevel = flowingLevelOffsets.length - 1
const expectedLavaMaxLevel = flowingLevelOffsets.filter(
  (offset) => offset % (OVERWORLD_LAVA_LEVEL_INCREMENT * FLUID_LEVEL_STEP) === 0,
).length - 1

const importBlockDataWithRegistry = async (
  blockIds: ReadonlyArray<number>,
  resolveProperty: (blockId: number, property: string) => unknown,
  resolveBlockType: (blockId: number) => unknown = () => Result.succeed('stone'),
) => {
  vi.resetModules()
  vi.doMock('@nerima-games/mc-kernel', () => ({
    AIR_BLOCK_ID: 0,
    BLOCK_ID_MAX: 0xffff,
    BLOCK_IDS: blockIds,
    FLOWING_FLUID_LEVEL,
    FLUID_LEVEL_STEP,
    blockTypeOfId: resolveBlockType,
    blockIdsWithOpacity: () => Result.succeed(Option.some(new Set())),
    isBlockType: (value: unknown) => typeof value === 'string',
    propertyOfBlockId: resolveProperty,
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

  it('derives every public fluid ceiling from the kernel flow levels', () => {
    const result = MINECRAFT_FLUID_MAX_LEVELS
    expect(Result.isFailure(result)).toBe(false)
    if (Result.isFailure(result)) {
      return
    }

    const fluidBlockIds = [...result.success.keys()]
    expect(fluidBlockIds.length).toBeGreaterThan(0)

    FastCheck.assert(
      FastCheck.property(FastCheck.constantFrom(...fluidBlockIds), (blockId) => {
        const fluidKind = propertyOfBlockId(blockId, 'fluid')
        if (Result.isFailure(fluidKind)) {
          return false
        }
        if (fluidKind.success === 'water') {
          return result.success.get(blockId) === expectedWaterMaxLevel
        }
        if (fluidKind.success === 'lava') {
          return result.success.get(blockId) === expectedLavaMaxLevel
        }
        return false
      }),
    )
  })

  it('classifies the registered cross models by name and excludes the torch', () => {
    const crossBlockIds = Result.getOrThrow(MINECRAFT_CROSS_PLANT_BLOCK_IDS)
    const crossTypes = [...crossBlockIds]
      .map((blockId) => Result.getOrThrow(blockTypeOfId(blockId)))
      .sort()
    const expectedCrossTypes = [
      'amethyst_cluster',
      'brown_mushroom',
      'cobweb',
      'dandelion',
      'fern',
      'kelp',
      'poppy',
      'red_mushroom',
      'sapling',
      'seagrass',
      'sugar_cane',
      'tall_grass',
    ].sort()

    expect(BLOCK_IDS.length).toBeGreaterThan(0)
    expect(crossTypes).toStrictEqual(expectedCrossTypes)
    expect(crossBlockIds.has(Option.getOrThrow(blockIdOf('torch')))).toBe(false)
    expect(classifyVanillaBlockType('torch')).toStrictEqual(Result.succeed('special'))
  })

  it('maps registered fluid kinds to their propagation ceilings', async () => {
    const blockData = await importBlockDataWithRegistry([1, 2, 3], (blockId, property) => {
      if (property === 'renderKind') {
        return Result.succeed(blockId === 3 ? 'cube' : 'fluid')
      }
      return Result.succeed(blockId === 1 ? 'water' : blockId === 2 ? 'lava' : new Map<string, unknown>().get('missing'))
    })

    expect(blockData.MINECRAFT_FLUID_MAX_LEVELS).toStrictEqual(
      Result.succeed(new Map([[1, expectedWaterMaxLevel], [2, expectedLavaMaxLevel]])),
    )
    expect(blockData.MINECRAFT_WATER_BLOCK_IDS).toStrictEqual(Result.succeed(new Set([1])))
    expect(blockData.MINECRAFT_CROSS_PLANT_BLOCK_IDS).toStrictEqual(Result.succeed(new Set()))
  })

  it('propagates block-property resolution failures from registry scans', async () => {
    const failure = { _tag: 'TestRegistryFailure' }
    const blockData = await importBlockDataWithRegistry([1], () => Result.fail(failure))

    expect(blockData.MINECRAFT_WATER_BLOCK_IDS).toStrictEqual(Result.fail(failure))
    expect(blockData.MINECRAFT_CROSS_PLANT_BLOCK_IDS).toStrictEqual(Result.succeed(new Set()))
    expect(blockData.MINECRAFT_FLUID_MAX_LEVELS).toStrictEqual(Result.fail(failure))
  })

  it('propagates block-type resolution failures during cross-model classification', async () => {
    const failure = { _tag: 'TestBlockTypeResolutionFailure' }
    const blockData = await importBlockDataWithRegistry(
      [1],
      () => Result.succeed(new Map<string, unknown>().get('missing')),
      () => Result.fail(failure),
    )

    expect(blockData.MINECRAFT_CROSS_PLANT_BLOCK_IDS).toStrictEqual(Result.fail(failure))
  })

  it('returns a typed failure when a registered type has no named model classification', async () => {
    const blockType = 'future_registry_block'
    const blockData = await importBlockDataWithRegistry(
      [1],
      () => Result.succeed(new Map<string, unknown>().get('missing')),
      () => Result.succeed(blockType),
    )

    expect(blockData.MINECRAFT_CROSS_PLANT_BLOCK_IDS).toStrictEqual(
      Result.fail({ _tag: 'UnclassifiedVanillaBlockType', blockType }),
    )
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
