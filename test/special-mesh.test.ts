import { describe, expect, it } from './effect-test.js'
import { Effect } from 'effect'
import {
  BLOCK_IDS,
  chunkCoord,
  type RenderKind,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { AIR, MAX_BLOCK_ID, blockIdsWithRenderKind } from '../src/domain/block-data'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  blockIndex,
  type ChunkView,
} from '../src/domain/chunk-view'
import { meshChunk, meshChunkNaive, meshChunkRegion } from '../src/domain/mesh'
import { MINECRAFT_MESH_CONFIG } from '../src/domain/opacity'
import { railShapeCodeOf } from '../src/domain/rail-types'
import {
  isSpecialBlock,
  meshSpecialBlocks,
  type RailSpecialBlockQuad,
} from '../src/domain/special-mesh'
import { railRenderKindOf } from '../src/domain/special-types'

const MISSING_BLOCK_ID = -1

const firstBlockId = (renderKind: RenderKind): number => {
  const blockId = BLOCK_IDS.find(
    (candidate) => candidate !== AIR && propertyOfBlockId(candidate, 'renderKind') === renderKind,
  ) ?? MISSING_BLOCK_ID
  if (blockId === MISSING_BLOCK_ID) {
    throw new Error(`mc-kernel has no ${renderKind} block`)
  }
  return blockId
}

const firstBlockIdWithCollisionShape = (shape: 'pressurePlate' | 'slab'): number => {
  const blockId = BLOCK_IDS.find(
    (candidate) => candidate !== AIR && propertyOfBlockId(candidate, 'collisionShape') === shape,
  ) ?? MISSING_BLOCK_ID
  if (blockId === MISSING_BLOCK_ID) {
    throw new Error(`mc-kernel has no ${shape} block`)
  }
  return blockId
}

const CACTUS = firstBlockId('cactus')
const LILY_PAD = firstBlockId('lilyPad')
const RAIL = firstBlockId('rail')
const OPAQUE_CUBE = firstBlockId('cube')
const SLAB = firstBlockIdWithCollisionShape('slab')
const PRESSURE_PLATE = firstBlockIdWithCollisionShape('pressurePlate')

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz, CHUNK_HEIGHT)] = blockId
  }
  return { coord: chunkCoord(0, 0), height: CHUNK_HEIGHT, blocks }
}

describe('kernel-defined special block geometry', () => {
  it.effect('derives every supported non-cube kind from mc-kernel', () =>
    Effect.sync(() => {
      expect(blockIdsWithRenderKind('cactus')).toContain(CACTUS)
      expect(blockIdsWithRenderKind('lilyPad')).toContain(LILY_PAD)
      expect(blockIdsWithRenderKind('rail')).toContain(RAIL)
      expect(isSpecialBlock(CACTUS)).toBe(true)
      expect(isSpecialBlock(LILY_PAD)).toBe(true)
      expect(isSpecialBlock(RAIL)).toBe(true)
      expect(isSpecialBlock(AIR)).toBe(false)
      expect(isSpecialBlock(OPAQUE_CUBE)).toBe(false)
      expect(isSpecialBlock(SLAB)).toBe(true)
      expect(isSpecialBlock(PRESSURE_PLATE)).toBe(true)
      expect(isSpecialBlock(MAX_BLOCK_ID + 1)).toBe(false)
    }),
  )

  it.effect('meshes slab and pressure plate collision shapes from mc-kernel', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [4, 64, 4, SLAB],
          [8, 64, 8, PRESSURE_PLATE],
        ]),
        {},
        MINECRAFT_MESH_CONFIG,
      )

      expect(layers.specialBlocks).toHaveLength(12)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'slab')).toHaveLength(6)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'pressurePlate')).toHaveLength(6)
      expect(layers.opaque).toHaveLength(0)
      expect(layers.transparentSolid).toHaveLength(0)
    }),
  )

  it.effect('keeps cactus, lily pad, and rail geometry out of cube layers', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [4, 64, 4, CACTUS],
          [8, 64, 8, LILY_PAD],
          [12, 64, 12, RAIL],
        ]),
        {},
        MINECRAFT_MESH_CONFIG,
      )

      expect(layers.specialBlocks).toHaveLength(9)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'cactus')).toHaveLength(6)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'lilyPad')).toHaveLength(1)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'rail')).toHaveLength(2)
      expect(layers.crossPlants).toHaveLength(0)
      expect(layers.fluids).toHaveLength(0)
      expect(layers.opaque).toHaveLength(0)
      expect(layers.water).toHaveLength(0)
      expect(layers.transparentSolid).toHaveLength(0)
    }),
  )

  it.effect('culls shared cactus faces and hides a cactus face behind an opaque cube', () =>
    Effect.sync(() => {
      const adjacent = meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, CACTUS],
        ]),
        {},
        MINECRAFT_MESH_CONFIG,
      )
      expect(adjacent.specialBlocks).toHaveLength(10)

      const blocked = meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, OPAQUE_CUBE],
        ]),
        {},
        MINECRAFT_MESH_CONFIG,
      )
      expect(blocked.specialBlocks).toHaveLength(5)
      expect(blocked.specialBlocks.every((quad) => quad.kind === 'cactus')).toBe(true)
      expect(blocked.opaque.length).toBeGreaterThan(0)
    }),
  )

  it.effect('emits the lily-pad top only when it is not covered', () =>
    Effect.sync(() => {
      const open = meshSpecialBlocks(chunkWith([[8, 64, 8, LILY_PAD]]), {}, CHUNK_HEIGHT)
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({ direction: 'yPos', kind: 'lilyPad', role: 'top' })
      expect(open[0]?.vertices.every(([, y]) => y === 64 + 1 / 64)).toBe(true)

      const covered = meshSpecialBlocks(
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
      )
      expect(covered).toHaveLength(0)

      const aboveDifferentKind = meshSpecialBlocks(
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, RAIL],
        ]),
        {},
        CHUNK_HEIGHT,
      )
      expect(aboveDifferentKind).toHaveLength(3)
    }),
  )

  it.effect('emits vanilla rail model faces and carries state plus kernel rail kind', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([[8, 64, 8, RAIL]]),
        {},
        MINECRAFT_MESH_CONFIG,
      )
      const expectedRailKind = propertyOfBlockId(RAIL, 'railKind')

      expect(layers.specialBlocks).toHaveLength(2)
      expect(layers.specialBlocks.every((quad) => quad.kind === 'rail')).toBe(true)
      const railQuads = layers.specialBlocks.filter(
        (quad): quad is RailSpecialBlockQuad => quad.kind === 'rail',
      )
      expect(railQuads.every((quad) => quad.railKind === expectedRailKind)).toBe(true)
      expect(new Set(railQuads.map((quad) => quad.role))).toStrictEqual(new Set(['top', 'bottom']))
      expect(new Set(railQuads.map((quad) => quad.direction))).toStrictEqual(new Set(['yPos', 'yNeg']))
      expect(new Set(layers.specialBlocks.map((quad) => quad.vertices[0]?.[2])).size).toBe(2)

      const railShapes = new Uint8Array(BLOCKS_PER_CHUNK)
      railShapes[blockIndex(8, 64, 8, CHUNK_HEIGHT)] = railShapeCodeOf('ascending_east')
      const stateful = meshChunk(
        { ...chunkWith([[8, 64, 8, RAIL]]), railShapes },
        {},
        MINECRAFT_MESH_CONFIG,
      )
      const statefulRails = stateful.specialBlocks.filter(
        (quad): quad is RailSpecialBlockQuad => quad.kind === 'rail',
      )
      expect(statefulRails.every((quad) => quad.railShape === 'ascending_east')).toBe(true)
      expect(statefulRails[0]?.vertices[0]).toStrictEqual([8, 64 + 1 / 16, 8])
      expect(statefulRails[0]?.vertices[2]).toStrictEqual([9, 64 + 17 / 16, 9])
    }),
  )

  it.effect('rejects the kernel sentinel for rail render geometry', () =>
    Effect.sync(() => {
      expect(railRenderKindOf('normal')).toBe('normal')
      expect(railRenderKindOf('powered')).toBe('powered')
      expect(() => railRenderKindOf('none')).toThrow('A rail render quad must declare a rail kind')
    }),
  )

  it.effect('keeps special output identical between merged, naive, and regional entry points', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [2, 5, 2, CACTUS],
        [8, 64, 8, LILY_PAD],
        [12, 200, 12, RAIL],
      ])
      const merged = meshChunk(chunk, {}, MINECRAFT_MESH_CONFIG)
      const naive = meshChunkNaive(chunk, {}, MINECRAFT_MESH_CONFIG)
      const regional = meshChunkRegion(chunk, {}, MINECRAFT_MESH_CONFIG, {
        max: [4, 10, 4],
        min: [0, 0, 0],
      })

      expect(merged.specialBlocks).toStrictEqual(naive.specialBlocks)
      expect(regional.layers.specialBlocks).toStrictEqual(merged.specialBlocks.slice(0, 6))
      expect(regional.ownedRegion).toStrictEqual({ max: [5, 11, 5], min: [0, 0, 0] })
    }),
  )

  it.effect('does not scan a special block above the requested ceiling', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[8, CHUNK_HEIGHT - 1, 8, CACTUS]])
      expect(meshSpecialBlocks(chunk, {}, CHUNK_HEIGHT - 1)).toHaveLength(0)
      expect(meshSpecialBlocks(chunk, {}, CHUNK_HEIGHT)).toHaveLength(6)
    }),
  )

  it.effect('meshes a special block at the top of a short chunk', () =>
    Effect.sync(() => {
      const height = 8
      const blocks = new Uint16Array(16 * height * 16)
      blocks[blockIndex(8, height - 1, 8, height)] = CACTUS

      const specialBlocks = meshSpecialBlocks({ blocks, coord: chunkCoord(0, 0), height }, {}, height)

      expect(specialBlocks).toHaveLength(6)
      expect(specialBlocks.every((quad) => quad.vertices.every(([, y]) => y <= height))).toBe(true)
    }),
  )
})
