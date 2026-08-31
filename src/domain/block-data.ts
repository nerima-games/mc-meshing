import { Brand } from 'effect'
import {
  AIR_BLOCK_ID,
  BLOCK_IDS,
  type BlockId,
  type RenderKind,
  blockIdsWithOpacity as kernelBlockIdsWithOpacity,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

export type { BlockId }

export const AIR: BlockId = AIR_BLOCK_ID

/**
 * The largest id THIS PACKAGE's own storage can represent — not kernel's
 * abstract `BlockId` ceiling.
 *
 * `ChunkView.blocks` is a `Uint8Array`, one byte per cell, by this package's
 * own storage-layout choice (`chunk-view.ts`), independent of whatever wire
 * format the kernel's `Chunk` uses internally. Kernel's own `BLOCK_ID_MAX`
 * widened from 255 to 0xffff when its `Chunk` wire format gained a 16-bit v2
 * element (mc-kernel 0.5.0) — a fact about the KERNEL's encoding. Re-exporting
 * that growing ceiling here would silently drift this constant away from what
 * a `Uint8Array` byte can actually hold, corrupting every `& MAX_BLOCK_ID`
 * mask below (`mesh-greedy.ts`'s `faceCellBlockId` packs `ao` starting at bit
 * 8, so a mask wider than one byte reads AO bits back as part of the id).
 */
export const MAX_BLOCK_ID = 0xff

/**
 * A `Uint8Array` element, or a value masked with `& MAX_BLOCK_ID`, is always
 * an integer in `[0, MAX_BLOCK_ID]` — exactly the range this package's own
 * storage can hold — so this is a structurally-guaranteed upcast, not an
 * unchecked claim about an arbitrary number. `Brand.nominal` applies the same
 * nominal tag mc-kernel's `BlockId` (a `Brand.refined`, validating
 * constructor) uses, but without a redundant runtime check on a value that is
 * already known-safe, and without the `as`/`!` syntax the org's
 * `no-type-assertion` ast-grep rule bans — unlike a manual guard, it adds no
 * branch a caller can never actually take, which a real `Uint8Array` byte or
 * an `& MAX_BLOCK_ID` mask never needs.
 */
const uncheckedBlockId = Brand.nominal<BlockId>()

/** Read one block id out of a chunk's byte storage, defaulting to `AIR` for an out-of-range index. */
export const blockIdAt = (blocks: Readonly<Uint8Array>, index: number): BlockId => {
  const raw = blocks[index]
  if (typeof raw === 'undefined') {
    return AIR
  }
  return uncheckedBlockId(raw)
}

export const blockIdsWithRenderKind = (kind: RenderKind): ReadonlySet<BlockId> =>
  new Set(BLOCK_IDS.filter((blockId) => propertyOfBlockId(blockId, 'renderKind') === kind))

export const MINECRAFT_WATER_BLOCK_IDS: ReadonlySet<BlockId> = new Set(
  BLOCK_IDS.filter((blockId) => propertyOfBlockId(blockId, 'fluid') === 'water'),
)

const registeredBlockIdsIn = (blockIds: ReadonlySet<number>): ReadonlySet<BlockId> =>
  new Set(BLOCK_IDS.filter((blockId) => blockIds.has(blockId)))

export const MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS: ReadonlySet<BlockId> = registeredBlockIdsIn(
  kernelBlockIdsWithOpacity('transparentSolid'),
)

export const MINECRAFT_CROSS_PLANT_BLOCK_IDS: ReadonlySet<BlockId> = blockIdsWithRenderKind('cross')

/**
 * The kernel exposes fluid kind but not the state-propagation level ceiling.
 * These are Minecraft's meshing-state ceilings, kept here until that state
 * becomes part of the kernel's public registry contract.
 */
const WATER_MAX_LEVEL = 7
const LAVA_MAX_LEVEL = 3

const fluidMaxLevelOf = function fluidMaxLevelOf(blockId: BlockId): number {
  const fluidKind = propertyOfBlockId(blockId, 'fluid')
  if (fluidKind === 'lava') {
    return LAVA_MAX_LEVEL
  }
  return WATER_MAX_LEVEL
}

export const MINECRAFT_FLUID_MAX_LEVELS: ReadonlyMap<BlockId, number> = new Map(
  BLOCK_IDS.filter((blockId) => propertyOfBlockId(blockId, 'renderKind') === 'fluid').map((blockId) => [
    blockId,
    fluidMaxLevelOf(blockId),
  ] as const),
)
