import { isBlockType, type BlockType } from '@nerima-games/mc-kernel'
import { Result } from 'effect'

export type VanillaBlockModelClass =
  | 'air'
  | 'cube'
  | 'closedBlockEntityCube'
  | 'cross'
  | 'crop'
  | 'fluid'
  | 'special'

export type UnclassifiedVanillaBlockType = {
  readonly _tag: 'UnclassifiedVanillaBlockType'
  readonly blockType: unknown
}

const EXPLICIT_CUBE_BLOCK_TYPE_NAMES = [
  'amethyst_block',
  'andesite',
  'bedrock',
  'bookshelf',
  'calcite',
  'coal_block',
  'coal_ore',
  'cobblestone',
  'copper_ore',
  'crafting_table',
  'deepslate',
  'deepslate_coal_ore',
  'deepslate_copper_ore',
  'deepslate_diamond_ore',
  'deepslate_emerald_ore',
  'deepslate_gold_ore',
  'deepslate_iron_ore',
  'deepslate_lapis_ore',
  'deepslate_redstone_ore',
  'diamond_block',
  'diamond_ore',
  'diorite',
  'dirt',
  'dispenser',
  'dropper',
  'emerald_block',
  'emerald_ore',
  'end_stone',
  'end_stone_bricks',
  'furnace',
  'glass',
  'glowstone',
  'gold_block',
  'gold_ore',
  'granite',
  'grass_block',
  'gravel',
  'ice',
  'iron_block',
  'iron_ore',
  'lapis_block',
  'lapis_ore',
  'nether_brick',
  'netherrack',
  'oak_leaves',
  'oak_log',
  'oak_planks',
  'observer',
  'obsidian',
  'prismarine',
  'purpur_block',
  'purpur_pillar',
  'redstone_block',
  'redstone_lamp',
  'redstone_lamp_lit',
  'redstone_ore',
  'sand',
  'sandstone',
  'smooth_basalt',
  'soul_sand',
  'soul_soil',
  'stone',
  'tnt',
] as const satisfies ReadonlyArray<BlockType>

export const EXPLICIT_CUBE_BLOCK_TYPES: ReadonlySet<BlockType> = new Set(EXPLICIT_CUBE_BLOCK_TYPE_NAMES)

const NAMED_NON_CUBE_BLOCK_MODELS: Partial<
  Record<BlockType, Exclude<VanillaBlockModelClass, 'air' | 'cube'>>
> = {
  amethyst_cluster: 'cross',
  anvil: 'special',
  bed: 'special',
  brewing_stand: 'special',
  brown_mushroom: 'cross',
  cauldron: 'special',
  chest: 'special',
  chorus_flower: 'special',
  chorus_plant: 'special',
  cobweb: 'cross',
  comparator: 'special',
  cactus: 'special',
  dandelion: 'cross',
  door: 'special',
  door_open: 'special',
  dragon_egg: 'special',
  enchanting_table: 'special',
  end_crystal: 'special',
  end_gateway: 'special',
  end_portal: 'special',
  end_portal_frame: 'special',
  end_portal_frame_filled: 'special',
  end_rod: 'special',
  ender_chest: 'special',
  farmland: 'special',
  fern: 'cross',
  fire: 'special',
  hopper: 'special',
  lever: 'special',
  kelp: 'cross',
  ladder: 'special',
  lava: 'fluid',
  lily_pad: 'special',
  nether_portal: 'special',
  nether_wart_crop: 'crop',
  potato_crop: 'crop',
  piston_head: 'special',
  powered_rail: 'special',
  poppy: 'cross',
  piston: 'special',
  pressure_plate: 'special',
  purpur_slab: 'special',
  purpur_stairs: 'special',
  rail: 'special',
  redstone_torch: 'special',
  redstone_wall_torch: 'special',
  redstone_wire: 'special',
  red_mushroom: 'cross',
  repeater: 'special',
  sapling: 'cross',
  seagrass: 'cross',
  shulker_box: 'closedBlockEntityCube',
  snow: 'special',
  sticky_piston: 'special',
  stone_button: 'special',
  stone_slab: 'special',
  sugar_cane: 'cross',
  tall_grass: 'cross',
  torch: 'special',
  water: 'fluid',
  water_cauldron: 'special',
  wheat_crop: 'crop',
  wither_skeleton_skull: 'special',
  oak_stairs: 'special',
}

export const classifyVanillaBlockType = (
  blockType: unknown,
): Result.Result<VanillaBlockModelClass, UnclassifiedVanillaBlockType> => {
  if (blockType === 'air') {
    return Result.succeed('air')
  }
  if (!isBlockType(blockType)) {
    return Result.fail({ _tag: 'UnclassifiedVanillaBlockType', blockType })
  }

  const nonCubeModel = NAMED_NON_CUBE_BLOCK_MODELS[blockType]
  if (typeof nonCubeModel !== 'undefined') {
    return Result.succeed(nonCubeModel)
  }
  if (EXPLICIT_CUBE_BLOCK_TYPES.has(blockType)) {
    return Result.succeed('cube')
  }
  return Result.fail({ _tag: 'UnclassifiedVanillaBlockType', blockType })
}
