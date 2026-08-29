import { BLOCK_IDS, propertyOfBlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { buildCrossPlantLookup, isCrossPlant } from '../src/domain/plant-mesh'
import { buildSpecialLookup, specialKindOf } from '../src/domain/special-mesh'
import { buildMinecraftMeshConfig, layerOfBlockId, MINECRAFT_MESH_CONFIG } from '../src/index'

const MAX_LEVEL_BY_FLUID = {
  lava: 3,
  water: 7,
} as const

describe('mc-kernel registry mesh coverage', () => {
  it.effect('routes every registered block from authoritative properties', () =>
    Effect.sync(() => {
      const config = buildMinecraftMeshConfig()
      const crossPlants = config.crossPlantBlockIds!
      const fluidLevels = config.fluidMaxLevels!
      const renderKinds = config.renderKindByBlockId!
      const collisionShapes = config.collisionShapeByBlockId!
      const crossLookup = buildCrossPlantLookup(config)
      const specialLookup = buildSpecialLookup(config)

      expect(renderKinds.size).toBe(BLOCK_IDS.length)
      expect(collisionShapes.size).toBe(BLOCK_IDS.length)

      for (const blockId of BLOCK_IDS) {
        const properties = {
          fluid: propertyOfBlockId(blockId, 'fluid'),
          opacity: propertyOfBlockId(blockId, 'opacity'),
          renderKind: propertyOfBlockId(blockId, 'renderKind'),
          collisionShape: propertyOfBlockId(blockId, 'collisionShape'),
        }

        expect(renderKinds.get(blockId)).toBe(properties.renderKind)
        expect(collisionShapes.get(blockId)).toBe(properties.collisionShape)
        expect(crossPlants.has(blockId)).toBe(properties.renderKind === 'cross')
        expect(isCrossPlant(crossLookup, blockId)).toBe(properties.renderKind === 'cross')
        expect(config.transparentSolidBlockIds.has(blockId)).toBe(properties.opacity === 'transparentSolid')
        expect(config.waterBlockIds.has(blockId)).toBe(properties.fluid === 'water')

        if (properties.renderKind === 'cross' || properties.renderKind === 'fluid') {
          expect(specialKindOf(specialLookup, blockId)).toBeNull()
        } else if (
          properties.renderKind === 'cactus' ||
          properties.renderKind === 'rail' ||
          properties.renderKind === 'lilyPad'
        ) {
          expect(specialKindOf(specialLookup, blockId)).toBe(properties.renderKind)
        } else if (properties.collisionShape === 'slab' || properties.collisionShape === 'pressurePlate') {
          expect(specialKindOf(specialLookup, blockId)).toBe(properties.collisionShape)
        } else {
          expect(specialKindOf(specialLookup, blockId)).toBeNull()
        }

        const expectedLayer =
          properties.opacity === 'transparentSolid'
            ? 'transparentSolid'
            : properties.fluid === 'water'
              ? 'water'
              : 'opaque'
        expect(layerOfBlockId(config, blockId)).toBe(expectedLayer)

        const expectedMaxLevel =
          properties.fluid === 'water'
              ? MAX_LEVEL_BY_FLUID.water
            : properties.fluid === 'lava'
              ? MAX_LEVEL_BY_FLUID.lava
              : null
        if (properties.renderKind === 'fluid' && expectedMaxLevel !== null) {
          expect(fluidLevels.get(blockId)).toBe(expectedMaxLevel)
        } else {
          expect(fluidLevels.has(blockId)).toBe(false)
        }
      }
    }),
  )

  it.effect('builds independent tables for callers that need a fresh configuration', () =>
    Effect.sync(() => {
      const rebuilt = buildMinecraftMeshConfig()

      expect(rebuilt).not.toBe(MINECRAFT_MESH_CONFIG)
      expect(rebuilt.renderKindByBlockId).not.toBe(MINECRAFT_MESH_CONFIG.renderKindByBlockId)
      expect(rebuilt.collisionShapeByBlockId).not.toBe(MINECRAFT_MESH_CONFIG.collisionShapeByBlockId)
      expect(rebuilt.fluidMaxLevels).not.toBe(MINECRAFT_MESH_CONFIG.fluidMaxLevels)
      expect(rebuilt.crossPlantBlockIds).not.toBe(MINECRAFT_MESH_CONFIG.crossPlantBlockIds)
      expect(rebuilt.transparentSolidBlockIds).not.toBe(MINECRAFT_MESH_CONFIG.transparentSolidBlockIds)
      expect(rebuilt.waterBlockIds).not.toBe(MINECRAFT_MESH_CONFIG.waterBlockIds)
    }),
  )
})
