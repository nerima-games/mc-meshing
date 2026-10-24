import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result } from 'effect'
import {
  BLOCK_IDS,
  ChunkAxis as chunkAxis,
  chunkCoord,
  type BlockId,
  type RenderKind,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { AIR, blockIdsWithRenderKind } from '../src/domain/block-data'
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
  SPECIAL_BLOCK_LOOKUP,
  type RailSpecialBlockQuad,
} from '../src/domain/special-mesh'
import { railRenderKindOf } from '../src/domain/special-types'

const MESH_CONFIG = Result.getOrThrow(MINECRAFT_MESH_CONFIG)
const SPECIAL_LOOKUP = Result.getOrThrow(SPECIAL_BLOCK_LOOKUP)

const firstBlockId = (renderKind: RenderKind): BlockId =>
  Option.getOrThrow(Option.fromNullishOr(
    BLOCK_IDS.find(
      (candidate) => candidate !== AIR &&
        Result.getOrThrow(propertyOfBlockId(candidate, 'renderKind')) === renderKind,
    ),
  ))

const firstBlockIdWithCollisionShape = (shape: 'pressurePlate' | 'slab'): BlockId =>
  Option.getOrThrow(Option.fromNullishOr(
    BLOCK_IDS.find(
      (candidate) => candidate !== AIR &&
        Result.getOrThrow(propertyOfBlockId(candidate, 'collisionShape')) === shape,
    ),
  ))

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
  return { coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height: CHUNK_HEIGHT, blocks }
}

describe('kernel-defined special block geometry', () => {
  it.effect('derives every supported non-cube kind from mc-kernel', () =>
    Effect.sync(() => {
      expect(Result.getOrThrow(blockIdsWithRenderKind('cactus'))).toContain(CACTUS)
      expect(Result.getOrThrow(blockIdsWithRenderKind('lilyPad'))).toContain(LILY_PAD)
      expect(Result.getOrThrow(blockIdsWithRenderKind('rail'))).toContain(RAIL)
      expect(isSpecialBlock(SPECIAL_LOOKUP, CACTUS)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, LILY_PAD)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, RAIL)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, AIR)).toBe(false)
      expect(isSpecialBlock(SPECIAL_LOOKUP, OPAQUE_CUBE)).toBe(false)
      expect(isSpecialBlock(SPECIAL_LOOKUP, SLAB)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, PRESSURE_PLATE)).toBe(true)
    }),
  )

  it.effect('meshes slab and pressure plate collision shapes from mc-kernel', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([
          [4, 64, 4, SLAB],
          [8, 64, 8, PRESSURE_PLATE],
        ]),
        {},
        MESH_CONFIG,
      ))

      expect(layers.specialBlocks).toHaveLength(12)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'slab')).toHaveLength(6)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'pressurePlate')).toHaveLength(6)
      expect(layers.opaque).toHaveLength(0)
      expect(layers.transparentSolid).toHaveLength(0)
    }),
  )

  it.effect('keeps cactus, lily pad, and rail geometry out of cube layers', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([
          [4, 64, 4, CACTUS],
          [8, 64, 8, LILY_PAD],
          [12, 64, 12, RAIL],
        ]),
        {},
        MESH_CONFIG,
      ))

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
      const adjacent = Result.getOrThrow(meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, CACTUS],
        ]),
        {},
        MESH_CONFIG,
      ))
      expect(adjacent.specialBlocks).toHaveLength(10)

      const blocked = Result.getOrThrow(meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, OPAQUE_CUBE],
        ]),
        {},
        MESH_CONFIG,
      ))
      expect(blocked.specialBlocks).toHaveLength(5)
      expect(blocked.specialBlocks.every((quad) => quad.kind === 'cactus')).toBe(true)
      expect(blocked.opaque.length).toBeGreaterThan(0)
    }),
  )

  it.effect('emits the lily-pad top only when it is not covered', () =>
    Effect.sync(() => {
      const open = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunkWith([[8, 64, 8, LILY_PAD]]), {}, CHUNK_HEIGHT))
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({ direction: 'yPos', kind: 'lilyPad', role: 'top' })
      expect(open[0]?.vertices.every(([, y]) => y === 64 + 1 / 64)).toBe(true)

      const covered = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(covered).toHaveLength(0)

      const aboveDifferentKind = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, RAIL],
        ]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(aboveDifferentKind).toHaveLength(3)
    }),
  )

  it.effect('emits vanilla rail model faces and carries state plus kernel rail kind', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([[8, 64, 8, RAIL]]),
        {},
        MESH_CONFIG,
      ))
      const expectedRailKind = Result.getOrThrow(propertyOfBlockId(RAIL, 'railKind'))

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
      const stateful = Result.getOrThrow(meshChunk(
        { ...chunkWith([[8, 64, 8, RAIL]]), railShapes },
        {},
        MESH_CONFIG,
      ))
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
      expect(railRenderKindOf('normal')).toStrictEqual(Result.succeed('normal'))
      expect(railRenderKindOf('powered')).toStrictEqual(Result.succeed('powered'))
      expect(railRenderKindOf('none')).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingRailRenderKind', railKind: 'none' },
      })
    }),
  )

  it.effect('keeps special output identical between merged, naive, and regional entry points', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [2, 5, 2, CACTUS],
        [8, 64, 8, LILY_PAD],
        [12, 200, 12, RAIL],
      ])
      const merged = Result.getOrThrow(meshChunk(chunk, {}, MESH_CONFIG))
      const naive = Result.getOrThrow(meshChunkNaive(chunk, {}, MESH_CONFIG))
      const regional = Result.getOrThrow(meshChunkRegion(chunk, {}, MESH_CONFIG, {
        max: [4, 10, 4],
        min: [0, 0, 0],
      }))

      expect(merged.specialBlocks).toStrictEqual(naive.specialBlocks)
      expect(regional.layers.specialBlocks).toStrictEqual(merged.specialBlocks.slice(0, 6))
      expect(regional.ownedRegion).toStrictEqual({ max: [4, 10, 4], min: [0, 0, 0] })
    }),
  )

  it.effect('does not scan a special block above the requested ceiling', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[8, CHUNK_HEIGHT - 1, 8, CACTUS]])
      expect(Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT - 1))).toHaveLength(0)
      expect(Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT))).toHaveLength(6)
    }),
  )

  it.effect('meshes a special block at the top of a short chunk', () =>
    Effect.sync(() => {
      const height = 8
      const blocks = new Uint16Array(16 * height * 16)
      blocks[blockIndex(8, height - 1, 8, height)] = CACTUS

      const specialBlocks = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        { blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height },
        {},
        height,
      ))

      expect(specialBlocks).toHaveLength(6)
      expect(specialBlocks.every((quad) => quad.vertices.every(([, y]) => y <= height))).toBe(true)
    }),
  )
})
