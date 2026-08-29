import {
  BLOCK_IDS,
  type CollisionShape,
  type RenderKind,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'

import type { MeshConfig } from './opacity.js'

const WATER_MAX_LEVEL = 7
const LAVA_MAX_LEVEL = 3

const MAX_LEVEL_BY_FLUID: Readonly<Record<'lava' | 'water', number>> = {
  lava: LAVA_MAX_LEVEL,
  water: WATER_MAX_LEVEL,
}

type MeshConfigTables = {
  readonly collisionShapeByBlockId: Map<number, CollisionShape>
  readonly crossPlantBlockIds: Set<number>
  readonly fluidMaxLevels: Map<number, number>
  readonly renderKindByBlockId: Map<number, RenderKind>
  readonly transparentSolidBlockIds: Set<number>
  readonly waterBlockIds: Set<number>
}

const emptyTables = (): MeshConfigTables => ({
  collisionShapeByBlockId: new Map<number, CollisionShape>(),
  crossPlantBlockIds: new Set<number>(),
  fluidMaxLevels: new Map<number, number>(),
  renderKindByBlockId: new Map<number, RenderKind>(),
  transparentSolidBlockIds: new Set<number>(),
  waterBlockIds: new Set<number>(),
})

const readBlockProperties = (blockId: number) => ({
    collisionShape: propertyOfBlockId(blockId, 'collisionShape'),
    fluid: propertyOfBlockId(blockId, 'fluid'),
    opacity: propertyOfBlockId(blockId, 'opacity'),
    renderKind: propertyOfBlockId(blockId, 'renderKind'),
})

type BlockMeshProperties = ReturnType<typeof readBlockProperties>

const addBlockCategories = (tables: MeshConfigTables, blockId: number, properties: BlockMeshProperties): void => {
  if (properties.opacity === 'transparentSolid') {
    tables.transparentSolidBlockIds.add(blockId)
  }
  if (properties.fluid === 'water') {
    tables.waterBlockIds.add(blockId)
  }
  if (properties.renderKind === 'cross') {
    tables.crossPlantBlockIds.add(blockId)
  }
  if (properties.renderKind === 'fluid' && properties.fluid !== 'none') {
    tables.fluidMaxLevels.set(blockId, MAX_LEVEL_BY_FLUID[properties.fluid])
  }
}

const addBlockToTables = (tables: MeshConfigTables, blockId: number): void => {
  const properties = readBlockProperties(blockId)
  tables.collisionShapeByBlockId.set(blockId, properties.collisionShape)
  tables.renderKindByBlockId.set(blockId, properties.renderKind)
  addBlockCategories(tables, blockId, properties)
}

const meshConfigFromTables = (tables: MeshConfigTables): MeshConfig => ({
  collisionShapeByBlockId: tables.collisionShapeByBlockId,
  crossPlantBlockIds: tables.crossPlantBlockIds,
  fluidMaxLevels: tables.fluidMaxLevels,
  renderKindByBlockId: tables.renderKindByBlockId,
  transparentSolidBlockIds: tables.transparentSolidBlockIds,
  waterBlockIds: tables.waterBlockIds,
})

/** Build the meshing tables directly from the kernel's authoritative registry. */
export const buildMinecraftMeshConfig = (): MeshConfig => {
  const tables = emptyTables()
  for (const blockId of BLOCK_IDS) {
    addBlockToTables(tables, blockId)
  }
  return meshConfigFromTables(tables)
}

/** The official block meshing configuration used when callers omit a config. */
export const MINECRAFT_MESH_CONFIG: MeshConfig = buildMinecraftMeshConfig()
