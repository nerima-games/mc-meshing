import { blockIdOf, BLOCK_ID_MAX, type CollisionShape, type RenderKind } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { AIR, type ChunkView } from '../src/domain/chunk-view'
import { buildMinecraftMeshConfig, MINECRAFT_MESH_CONFIG } from '../src/domain/kernel-mesh-config'
import { meshChunk, meshChunkNaive } from '../src/domain/mesh'
import { type MeshConfig } from '../src/domain/opacity'
import { buildSpecialLookup, isSpecialBlock, meshSpecialBlocks, specialKindOf } from '../src/domain/special-mesh'
import { TEST_BLOCKS_PER_CHUNK, TEST_HEIGHT, testBlockIndex, testChunk } from './chunk-fixtures'

const STONE = blockIdOf('stone')
const WATER = blockIdOf('water')
const CACTUS = blockIdOf('cactus')
const RAIL = blockIdOf('rail')
const LILY_PAD = blockIdOf('lily_pad')
const DANDELION = blockIdOf('dandelion')
const STONE_SLAB = blockIdOf('stone_slab')
const PRESSURE_PLATE = blockIdOf('pressure_plate')

const chunkWith = (
  cells: ReadonlyArray<readonly [x: number, y: number, z: number, blockId: number]>,
): ChunkView => {
  const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  for (const [x, y, z, blockId] of cells) {
    blocks[testBlockIndex(x, y, z)] = blockId
  }
  return testChunk(blocks)
}

const airVisibility = (_blockId: number, neighbourId: number): boolean => neighbourId === AIR

const SPECIAL_CONFIG: MeshConfig = {
  renderKindByBlockId: new Map<number, RenderKind>([
    [CACTUS, 'cactus'],
    [RAIL, 'rail'],
    [LILY_PAD, 'lilyPad'],
  ]),
  transparentSolidBlockIds: new Set(),
  waterBlockIds: new Set(),
}

describe('kernel-driven special meshing', () => {
  it.effect('builds special lookup and mesh tables from the kernel registry', () =>
    Effect.sync(() => {
      const config = buildMinecraftMeshConfig()
      const lookup = buildSpecialLookup(config)

      expect(config.renderKindByBlockId?.get(CACTUS)).toBe('cactus')
      expect(config.renderKindByBlockId?.get(RAIL)).toBe('rail')
      expect(config.renderKindByBlockId?.get(LILY_PAD)).toBe('lilyPad')
      expect(config.collisionShapeByBlockId?.get(STONE_SLAB)).toBe('slab')
      expect(config.collisionShapeByBlockId?.get(PRESSURE_PLATE)).toBe('pressurePlate')
      expect(config.fluidMaxLevels?.get(WATER)).toBe(7)
      expect(config.crossPlantBlockIds?.has(DANDELION)).toBe(true)
      expect(specialKindOf(lookup, CACTUS)).toBe('cactus')
      expect(specialKindOf(lookup, RAIL)).toBe('rail')
      expect(specialKindOf(lookup, LILY_PAD)).toBe('lilyPad')
      expect(specialKindOf(lookup, STONE)).toBeNull()
      expect(specialKindOf(lookup, BLOCK_ID_MAX + 1)).toBeNull()
      expect(isSpecialBlock(lookup, CACTUS)).toBe(true)
      expect(isSpecialBlock(lookup, STONE)).toBe(false)
      expect(isSpecialBlock(lookup, BLOCK_ID_MAX + 1)).toBe(false)
    }),
  )

  it.effect('maps fixed collision shapes without requiring render kinds', () =>
    Effect.sync(() => {
      const collisionShapes = new Map<number, CollisionShape>([
        [STONE_SLAB, 'slab'],
        [PRESSURE_PLATE, 'pressurePlate'],
      ])
      const lookup = buildSpecialLookup({
        collisionShapeByBlockId: collisionShapes,
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set(),
      })

      expect(specialKindOf(lookup, STONE_SLAB)).toBe('slab')
      expect(specialKindOf(lookup, PRESSURE_PLATE)).toBe('pressurePlate')
    }),
  )

  it.effect('ignores non-special render kinds when building the compact lookup', () =>
    Effect.sync(() => {
      const lookup = buildSpecialLookup({
        ...SPECIAL_CONFIG,
        renderKindByBlockId: new Map<number, RenderKind>([
          [STONE, 'cube'],
          [CACTUS, 'cross'],
          [RAIL, 'fluid'],
        ]),
      })

      expect(isSpecialBlock(lookup, STONE)).toBe(false)
      expect(isSpecialBlock(lookup, CACTUS)).toBe(false)
      expect(isSpecialBlock(lookup, RAIL)).toBe(false)
    }),
  )

  it.effect('leaves special geometry disabled when render kinds are not configured', () =>
    Effect.sync(() => {
      const lookup = buildSpecialLookup({
        transparentSolidBlockIds: new Set(),
        waterBlockIds: new Set(),
      })

      expect(isSpecialBlock(lookup, CACTUS)).toBe(false)
    }),
  )

  it.effect('emits cactus, rail, and lily-pad geometry with their canonical shapes', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [1, 4, 1, CACTUS],
        [4, 4, 4, RAIL],
        [7, 4, 7, LILY_PAD],
        [10, 4, 10, STONE],
      ])
      const layers = meshChunk(chunk, {})
      const naive = meshChunkNaive(chunk, {})

      expect(layers.specials).toHaveLength(9)
      expect(layers.specials.filter((quad) => quad.renderKind === 'cactus')).toHaveLength(6)
      expect(layers.specials.filter((quad) => quad.renderKind === 'rail')).toHaveLength(2)
      expect(layers.specials.filter((quad) => quad.renderKind === 'lilyPad')).toHaveLength(1)
      expect(layers.specials).toStrictEqual(naive.specials)
      expect(layers.opaque.some((quad) => quad.lx === 1 && quad.y === 4 && quad.lz === 1)).toBe(false)
      expect(layers.specials[0]?.vertices[0]).toStrictEqual([1 + 1 - 1 / 16, 4 + 1 / 16, 1 + 1 / 16])
      expect(layers.specials.find((quad) => quad.renderKind === 'lilyPad')?.vertices).toStrictEqual([
        [7 + 1 / 16, 4 + 1 / 64, 8 - 1 / 16],
        [8 - 1 / 16, 4 + 1 / 64, 8 - 1 / 16],
        [8 - 1 / 16, 4 + 1 / 64, 7 + 1 / 16],
        [7 + 1 / 16, 4 + 1 / 64, 7 + 1 / 16],
      ])
    }),
  )

  it.effect('emits fixed slab and pressure-plate geometry', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [1, 4, 1, STONE_SLAB],
        [4, 4, 4, PRESSURE_PLATE],
      ])
      const layers = meshChunk(chunk, {})
      const naive = meshChunkNaive(chunk, {})
      const slabs = layers.specials.filter((quad) => quad.renderKind === 'slab')
      const pressurePlates = layers.specials.filter((quad) => quad.renderKind === 'pressurePlate')

      expect(slabs).toHaveLength(6)
      expect(pressurePlates).toHaveLength(6)
      expect(layers.specials).toStrictEqual(naive.specials)
      expect(slabs.find((quad) => quad.direction === 'yPos')?.vertices).toStrictEqual([
        [1, 4.5, 2],
        [2, 4.5, 2],
        [2, 4.5, 1],
        [1, 4.5, 1],
      ])
      expect(pressurePlates.find((quad) => quad.direction === 'yPos')?.vertices).toStrictEqual([
        [4 + 1 / 16, 4 + 1 / 16, 5 - 1 / 16],
        [5 - 1 / 16, 4 + 1 / 16, 5 - 1 / 16],
        [5 - 1 / 16, 4 + 1 / 16, 4 + 1 / 16],
        [4 + 1 / 16, 4 + 1 / 16, 4 + 1 / 16],
      ])
    }),
  )

  it.effect('culls hidden special faces and respects an owned region', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [1, 4, 1, CACTUS],
        [2, 4, 1, STONE],
        [4, 4, 4, RAIL],
        [4, 5, 4, STONE],
        [7, 4, 7, LILY_PAD],
        [7, 5, 7, STONE],
      ])
      const lookup = buildSpecialLookup(MINECRAFT_MESH_CONFIG)
      const hidden = meshSpecialBlocks({
        bounds: { maxX: 8, maxY: 5, maxZ: 8, minX: 1, minY: 4, minZ: 1 },
        chunk,
        isFaceVisible: airVisibility,
        lookup,
        neighbours: {},
        yLimit: TEST_HEIGHT,
      })
      const restricted = meshSpecialBlocks({
        bounds: { maxX: 2, maxY: 5, maxZ: 2, minX: 1, minY: 4, minZ: 1 },
        chunk,
        isFaceVisible: airVisibility,
        lookup,
        neighbours: {},
        yLimit: TEST_HEIGHT,
      })

      expect(hidden).toHaveLength(5)
      expect(hidden.every((quad) => quad.renderKind === 'cactus')).toBe(true)
      expect(restricted).toHaveLength(5)
    }),
  )
})
