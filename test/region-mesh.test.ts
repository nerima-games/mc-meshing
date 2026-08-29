import { blockIdOf, type RenderKind } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { type ChunkView, emptyChunk } from '../src/domain/chunk-view'
import { type MeshLayers, type MeshRegion, meshChunkNaive, meshChunkRegion } from '../src/domain/mesh'
import { MESH_LAYERS, type MeshConfig } from '../src/domain/opacity'
import { TEST_BLOCKS_PER_CHUNK, TEST_HEIGHT, testBlockIndex, testChunk } from './chunk-fixtures'

const STONE = 1
const WATER = 2
const FLOWER = 3
const CACTUS = blockIdOf('cactus')
const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([FLOWER]),
  fluidMaxLevels: new Map([[WATER, 8]]),
  transparentSolidBlockIds: new Set(),
  waterBlockIds: new Set([WATER]),
}

const SPECIAL_CONFIG: MeshConfig = {
  ...CONFIG,
  renderKindByBlockId: new Map<number, RenderKind>([[CACTUS, 'cactus']]),
}

const chunkWith = (
  cells: ReadonlyArray<readonly [number, number, number, number]>,
  fluidCells: ReadonlyArray<readonly [x: number, y: number, z: number, level: number]> = [],
): ChunkView => {
  const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  for (const [x, y, z, id] of cells) {blocks[testBlockIndex(x, y, z)] = id}
  if (fluidCells.length === 0) {return testChunk(blocks)}
  const levels = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  const sources = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  for (const [x, y, z, level] of fluidCells) {levels[testBlockIndex(x, y, z)] = level}
  return testChunk(blocks, { levels, sources })
}

const inRegion = (region: MeshRegion, x: number, y: number, z: number): boolean =>
  x >= region.min[0] && x < region.max[0] && y >= region.min[1] && y < region.max[1] && z >= region.min[2] && z < region.max[2]

const origin = (vertices: ReadonlyArray<readonly [number, number, number]>): readonly [number, number, number] => [
  Math.floor(Math.min(...vertices.map(([x]) => x))),
  Math.floor(Math.min(...vertices.map(([, y]) => y))),
  Math.floor(Math.min(...vertices.map(([, , z]) => z))),
]

const fluidOrigin = (quad: MeshLayers['fluids'][number]): readonly [number, number, number] => {
  const [x, y, z] = origin(quad.vertices)
  switch (quad.direction) {
    case 'xPos': return [x - 1, y, z]
    case 'yPos': return [x, Math.ceil(Math.max(...quad.vertices.map(([, vy]) => vy))) - 1, z]
    case 'zPos': return [x, y, z - 1]
    default: return [x, y, z]
  }
}

const project = (layers: MeshLayers, region: MeshRegion): MeshLayers => ({
  crossPlants: layers.crossPlants.filter((q) => inRegion(region, ...origin(q.vertices))),
  fluids: layers.fluids.filter((q) => inRegion(region, ...fluidOrigin(q))),
  opaque: layers.opaque.filter((q) => inRegion(region, q.lx, q.y, q.lz)),
  specials: layers.specials.filter((q) => inRegion(region, ...origin(q.vertices))),
  transparentSolid: layers.transparentSolid.filter((q) => inRegion(region, q.lx, q.y, q.lz)),
  water: layers.water.filter((q) => inRegion(region, q.lx, q.y, q.lz)),
})

describe('subregion meshing', () => {
  it.effect('expands a dirty AABB by one cell and matches the corresponding naive cells', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [7, 20, 8, STONE], [8, 20, 8, STONE], [9, 20, 8, STONE],
        [8, 21, 8, FLOWER], [8, 19, 8, WATER], [12, 20, 8, STONE],
      ])
      const result = meshChunkRegion(chunk, {}, CONFIG, { max: [9, 21, 9], min: [8, 20, 8] })
      expect(result.ownedRegion).toStrictEqual({ max: [10, 22, 10], min: [7, 19, 7] })
      expect(result.layers).toStrictEqual(project(meshChunkNaive(chunk, {}, CONFIG), result.ownedRegion))
      expect(meshChunkRegion(chunk, {}, CONFIG, result.dirtyRegion)).toStrictEqual(result)
    }),
  )

  it.effect('clamps the halo at a chunk boundary while consulting the neighbour for faces and AO', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[15, 40, 8, STONE]])
      const xPos = chunkWith([[0, 40, 8, STONE], [0, 41, 8, STONE]])
      const result = meshChunkRegion(chunk, { xPos }, CONFIG, { max: [16, 41, 9], min: [15, 40, 8] })
      expect(result.ownedRegion).toStrictEqual({ max: [16, 42, 10], min: [14, 39, 7] })
      expect(result.layers).toStrictEqual(project(meshChunkNaive(chunk, { xPos }, CONFIG), result.ownedRegion))
      expect(result.layers.opaque.some((quad) => quad.direction === 'xPos')).toBe(false)
    }),
  )

  it.effect('preserves fluid flow descriptors while matching the naive projection', () =>
    Effect.sync(() => {
      const chunk = chunkWith(
        [
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
        ],
        [
          [8, 64, 8, 0],
          [9, 64, 8, 8],
        ],
      )
      const result = meshChunkRegion(chunk, {}, CONFIG, { max: [9, 65, 9], min: [8, 64, 8] })
      expect(result.layers).toStrictEqual(project(meshChunkNaive(chunk, {}, CONFIG), result.ownedRegion))
      expect(result.layers.fluids.find((quad) => quad.direction === 'yPos')?.flow?.direction).toStrictEqual([1, 0])
    }),
  )

  it.effect('meshes special geometry inside an owned region', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[8, 64, 8, CACTUS]])
      const result = meshChunkRegion(chunk, {}, SPECIAL_CONFIG, { max: [9, 65, 9], min: [8, 64, 8] })

      expect(result.layers.specials).toHaveLength(6)
      expect(result.layers.specials.every((quad) => quad.renderKind === 'cactus')).toBe(true)
    }),
  )

  it.effect('returns owned empty buffers for an empty or reversed region', () =>
    Effect.sync(() => {
      const result = meshChunkRegion(emptyChunk(TEST_HEIGHT), {}, CONFIG, { max: [4, 4, 4], min: [9, 9, 9] })
      expect(result.dirtyRegion).toStrictEqual({ max: [9, 9, 9], min: [9, 9, 9] })
      expect(result.ownedRegion).toStrictEqual(result.dirtyRegion)
      expect(MESH_LAYERS.every((layer) => result.layers[layer].length === 0)).toBe(true)
      expect(result.layers.crossPlants).toStrictEqual([])
      expect(result.layers.fluids).toStrictEqual([])

      const nonFinite = meshChunkRegion(emptyChunk(TEST_HEIGHT), {}, CONFIG, {
        max: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        min: [Number.NaN, Number.NaN, Number.NaN],
      })
      expect(nonFinite.dirtyRegion).toStrictEqual({ max: [0, 0, 0], min: [0, 0, 0] })
    }),
  )
})
