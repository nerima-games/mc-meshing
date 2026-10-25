import type { BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel/domain/block-registry'
import { Brand, Option, Result } from 'effect'
import {
  AIR_BLOCK_ID,
  BLOCK_ID_MAX,
  BLOCK_IDS,
  type BlockId,
  type RenderKind,
  blockIdsWithOpacity as kernelBlockIdsWithOpacity,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

export type { BlockId }

export const AIR: BlockId = AIR_BLOCK_ID

/**
 * The largest id this package's own storage can represent.
 *
 * `ChunkView.blocks` is a `Uint16Array`, two bytes per cell (`chunk-view.ts`),
 * matching kernel's own `BLOCK_ID_MAX` and `BlockState`'s 16-bit wire element
 * exactly — re-exported rather than restated as a literal, so the two cannot
 * drift apart the way they did before this storage widened (this constant was
 * `0xff` while kernel's ceiling had already moved to `0xffff`). Every
 * `& MAX_BLOCK_ID` mask below (`mesh-greedy.ts`'s `faceCellBlockId`) relies on
 * this matching the storage width exactly: `mesh-greedy.ts`'s `AO_SHIFT` packs
 * `ao` starting at bit 16, immediately above it.
 */
export const MAX_BLOCK_ID: number = BLOCK_ID_MAX

/** A value read from Uint16Array is already in the kernel BlockId range 0..65535. */
const blockIdFromUint16 = Brand.nominal<BlockId>()

/** Read one block id out of a chunk's element storage, defaulting to `AIR` for an out-of-range index. */
export const blockIdAt = (blocks: Readonly<Uint16Array>, index: number): BlockId => {
  const raw = blocks[index]
  if (typeof raw === 'undefined') {
    return AIR
  }
  return blockIdFromUint16(raw)
}

const collectBlockIds = (
  matches: (blockId: BlockId) => Result.Result<boolean, BlockRegistryResolutionFailure>,
): Result.Result<ReadonlySet<BlockId>, BlockRegistryResolutionFailure> => {
  const blockIds = new Set<BlockId>()
  for (const blockId of BLOCK_IDS) {
    const match = matches(blockId)
    if (Result.isFailure(match)) {
      return Result.fail(match.failure)
    }
    if (match.success) {
      blockIds.add(blockId)
    }
  }
  return Result.succeed(blockIds)
}

export const blockIdsWithRenderKind = (
  kind: RenderKind,
): Result.Result<ReadonlySet<BlockId>, BlockRegistryResolutionFailure> =>
  collectBlockIds((blockId) =>
    Result.map(propertyOfBlockId(blockId, 'renderKind'), (renderKind) => renderKind === kind),
  )

export const MINECRAFT_WATER_BLOCK_IDS: Result.Result<
  ReadonlySet<BlockId>,
  BlockRegistryResolutionFailure
> = collectBlockIds((blockId) =>
  Result.map(propertyOfBlockId(blockId, 'fluid'), (fluidKind) => fluidKind === 'water'),
)

export const MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS: Result.Result<
  Option.Option<ReadonlySet<BlockId>>,
  BlockRegistryResolutionFailure
> = Result.map(kernelBlockIdsWithOpacity('transparentSolid'), (blockIds) =>
  Option.map(blockIds, (ids) => new Set(ids)),
)

export const MINECRAFT_CROSS_PLANT_BLOCK_IDS: Result.Result<
  ReadonlySet<BlockId>,
  BlockRegistryResolutionFailure
> = blockIdsWithRenderKind('cross')

/**
 * The kernel exposes fluid kind but not the state-propagation level ceiling.
 * These are Minecraft's meshing-state ceilings, kept here until that state
 * becomes part of the kernel's public registry contract.
 */
const WATER_MAX_LEVEL = 7
const LAVA_MAX_LEVEL = 3

export type MissingFluidKindFailure = {
  readonly _tag: 'MissingFluidKind'
  readonly blockId: BlockId
}

export type BlockDataFailure = BlockRegistryResolutionFailure | MissingFluidKindFailure

const fluidMaxLevelOf = (blockId: BlockId): Result.Result<number, BlockDataFailure> =>
  Result.flatMap(propertyOfBlockId(blockId, 'fluid'), (fluidKind) => {
    if (fluidKind === 'lava') {
      return Result.succeed(LAVA_MAX_LEVEL)
    }
    if (fluidKind === 'water') {
      return Result.succeed(WATER_MAX_LEVEL)
    }
    return Result.fail({ _tag: 'MissingFluidKind', blockId })
  })

export const MINECRAFT_FLUID_MAX_LEVELS: Result.Result<
  ReadonlyMap<BlockId, number>,
  BlockDataFailure
> = (() => {
  const levels = new Map<BlockId, number>()
  for (const blockId of BLOCK_IDS) {
    const renderKind = propertyOfBlockId(blockId, 'renderKind')
    if (Result.isFailure(renderKind)) {
      return Result.fail(renderKind.failure)
    }
    if (renderKind.success !== 'fluid') {
      continue
    }
    const maxLevel = fluidMaxLevelOf(blockId)
    if (Result.isFailure(maxLevel)) {
      return Result.fail(maxLevel.failure)
    }
    levels.set(blockId, maxLevel.success)
  }
  return Result.succeed(levels)
})()
