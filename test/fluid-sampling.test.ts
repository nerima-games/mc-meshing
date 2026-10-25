import { Brand, Result } from 'effect'
import { BlockId as KernelBlockId, BLOCK_ID_MAX, type BlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  blockIndex,
  emptyChunk as emptyChunkResult,
} from '../src/domain/chunk-view.js'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity.js'
import { buildFluidLookup, heightIn, isFluidBlock, maxLevelOf, validateFluidViews } from '../src/domain/fluid-sampling.js'

const BLOCK_ID = Result.getOrThrow(KernelBlockId.result(1))
const MISSING_BLOCK_ID = Result.getOrThrow(KernelBlockId.result(5))
// Deliberately model malformed untrusted input so the public validation boundary is exercised.
const UNVALIDATED_BLOCK_ID = Brand.nominal<BlockId>()(BLOCK_ID_MAX + 1)
const invalidFixture = <T,>(value: any): T => value

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

  it('rejects ids outside the kernel domain before writing or reading the lookup', () => {
    const config = {
      ...EMPTY_MESH_CONFIG,
      fluidMaxLevels: new Map([[UNVALIDATED_BLOCK_ID, 1]]),
    }
    const lookup = new Uint16Array(BLOCK_ID_MAX + 1)

    expect(buildFluidLookup(config)).toMatchObject({ failure: { _tag: 'BrandError' } })
    expect(maxLevelOf(lookup, UNVALIDATED_BLOCK_ID)).toMatchObject({ failure: { _tag: 'BrandError' } })
  })

  it('returns no fluid height when the block id is absent from the fluid table', () => {
    const height = 1
    const emptyChunk = Result.getOrThrow(emptyChunkResult(height))
    const blocks = new Uint16Array(emptyChunk.blocks)
    blocks[blockIndex(2, 0, 3, height)] = MISSING_BLOCK_ID
    const space = {
      chunk: { ...emptyChunk, blocks },
      neighbours: {},
      context: {
        fluids: Result.getOrThrow(buildFluidLookup(EMPTY_MESH_CONFIG)),
        layers: new Uint8Array(BLOCK_ID_MAX + 1),
        plants: new Uint8Array(BLOCK_ID_MAX + 1),
      },
    }

    expect(heightIn(space, [2, 0, 3], MISSING_BLOCK_ID)).toBe(-1)
  })

  it('returns structured failures for incomplete and null FluidView sidecars', () => {
    const height = 1
    const empty = Result.getOrThrow(emptyChunkResult(height))
    const incomplete = {
      ...empty,
      fluid: {
        levels: new Uint8Array(0),
        sources: new Uint8Array(empty.blocks.length),
        falling: new Uint8Array(empty.blocks.length),
      },
    }
    expect(validateFluidViews(incomplete, {})).toMatchObject({
      failure: {
        _tag: 'IncompleteFluidView',
        actual: 0,
        expected: empty.blocks.length,
        field: 'levels',
      },
    })

    const nullSidecar = invalidFixture<Parameters<typeof validateFluidViews>[0]>({ ...empty, fluid: null })
    expect(validateFluidViews(nullSidecar, {})).toMatchObject({
      failure: { _tag: 'InvalidFluidView', field: 'fluid' },
    })
  })

  it('skips neighbour slots without a loaded ChunkView', () => {
    const height = 1
    const empty = Result.getOrThrow(emptyChunkResult(height))
    const unloadedNeighbour = invalidFixture<Parameters<typeof validateFluidViews>[1]>({
      xPos: Reflect.get({}, 'xPos'),
    })

    expect(Result.isSuccess(validateFluidViews(empty, unloadedNeighbour))).toBe(true)
  })

  it('rejects each missing, null, or non-byte FluidView array', () => {
    const height = 1
    const empty = Result.getOrThrow(emptyChunkResult(height))
    const completeFluid = {
      levels: new Uint8Array(empty.blocks.length),
      sources: new Uint8Array(empty.blocks.length),
      falling: new Uint8Array(empty.blocks.length),
    }
    const fields = ['levels', 'sources', 'falling'] as const

    for (const field of fields) {
      const missingFieldFluid = { ...completeFluid }
      Reflect.deleteProperty(missingFieldFluid, field)
      const missingFieldChunk = invalidFixture<Parameters<typeof validateFluidViews>[0]>({
        ...empty,
        fluid: missingFieldFluid,
      })
      expect(validateFluidViews(missingFieldChunk, {})).toMatchObject({
        failure: { _tag: 'InvalidFluidView', field },
      })

      const nullFieldChunk = invalidFixture<Parameters<typeof validateFluidViews>[0]>({
        ...empty,
        fluid: { ...completeFluid, [field]: null },
      })
      expect(validateFluidViews(nullFieldChunk, {})).toMatchObject({
        failure: { _tag: 'InvalidFluidView', field },
      })

      const nonByteArrayChunk = invalidFixture<Parameters<typeof validateFluidViews>[0]>({
        ...empty,
        fluid: { ...completeFluid, [field]: new Float32Array(empty.blocks.length) },
      })
      expect(validateFluidViews(nonByteArrayChunk, {})).toMatchObject({
        failure: { _tag: 'InvalidFluidView', field },
      })
    }
  })

  it('samples a complete FluidView directly when no validated view map is supplied', () => {
    const height = 1
    const empty = Result.getOrThrow(emptyChunkResult(height))
    const position: readonly [number, number, number] = [2, 0, 3]
    const index = blockIndex(...position, height)
    const blocks = new Uint16Array(empty.blocks)
    blocks[index] = BLOCK_ID
    const fluid = {
      levels: new Uint8Array(empty.blocks.length),
      sources: new Uint8Array(empty.blocks.length),
      falling: new Uint8Array(empty.blocks.length),
    }
    fluid.levels[index] = 1
    const chunk = { ...empty, blocks, fluid }
    const config = {
      ...EMPTY_MESH_CONFIG,
      fluidMaxLevels: new Map<BlockId, number>([[BLOCK_ID, 8]]),
    }
    const space = {
      chunk,
      neighbours: {},
      context: {
        fluids: Result.getOrThrow(buildFluidLookup(config)),
        layers: new Uint8Array(BLOCK_ID_MAX + 1),
        plants: new Uint8Array(BLOCK_ID_MAX + 1),
      },
    }

    expect(heightIn(space, position, BLOCK_ID)).toBe(8 / 9)
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
