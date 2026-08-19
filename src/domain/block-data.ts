import {
  AIR_BLOCK_ID,
  BLOCK_IDS,
  BLOCK_ID_MAX,
  type BlockId,
  type RenderKind,
  blockIdsWithOpacity as kernelBlockIdsWithOpacity,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

export type { BlockId }

export const AIR = AIR_BLOCK_ID

export const MAX_BLOCK_ID = BLOCK_ID_MAX

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

export const MINECRAFT_CROSS_PLANT_BLOCK_IDS = blockIdsWithRenderKind('cross')

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
