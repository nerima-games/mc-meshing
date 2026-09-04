import { describe, expect, it } from './effect-test.js'
import { Effect } from 'effect'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, type ChunkView, blockIndex, emptyChunk } from '../src/domain/chunk-view'
import { type MeshLayers, type MeshRegion, meshChunkNaive, meshChunkRegion } from '../src/domain/mesh'
import { MESH_LAYERS, type MeshConfig } from '../src/domain/opacity'

const STONE = 1
const WATER = 2
const FLOWER = 3
const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([FLOWER]),
  fluidMaxLevels: new Map([[WATER, 8]]),
  transparentSolidBlockIds: new Set(),
  waterBlockIds: new Set([WATER]),
}

const chunkWith = (
  cells: ReadonlyArray<readonly [number, number, number, number]>,
  fluidCells: ReadonlyArray<readonly [x: number, y: number, z: number, level: number]> = [],
): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  for (const [x, y, z, id] of cells) {blocks[blockIndex(x, y, z, CHUNK_HEIGHT)] = id}
  if (fluidCells.length === 0) {return { coord: chunkCoord(0, 0), height: CHUNK_HEIGHT, blocks }}
  const falling = new Uint8Array(BLOCKS_PER_CHUNK)
  const levels = new Uint8Array(BLOCKS_PER_CHUNK)
  const sources = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [x, y, z, level] of fluidCells) {levels[blockIndex(x, y, z, CHUNK_HEIGHT)] = level}
  return { coord: chunkCoord(0, 0), height: CHUNK_HEIGHT, blocks, fluid: { falling, levels, sources } }
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
  specialBlocks: layers.specialBlocks.filter((q) => inRegion(region, ...origin(q.vertices))),
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

  it.effect('returns owned empty buffers for an empty or reversed region', () =>
    Effect.sync(() => {
      const result = meshChunkRegion(emptyChunk(), {}, CONFIG, { max: [4, 4, 4], min: [9, 9, 9] })
      expect(result.dirtyRegion).toStrictEqual({ max: [9, 9, 9], min: [9, 9, 9] })
      expect(result.ownedRegion).toStrictEqual(result.dirtyRegion)
      expect(MESH_LAYERS.every((layer) => result.layers[layer].length === 0)).toBe(true)
      expect(result.layers.crossPlants).toStrictEqual([])
      expect(result.layers.fluids).toStrictEqual([])
    }),
  )

  it.effect('clamps non-finite region bounds to their lower edge', () =>
    Effect.sync(() => {
      const result = meshChunkRegion(emptyChunk(), {}, CONFIG, {
        max: [1, 1, 1],
        min: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      })
      expect(result.dirtyRegion).toStrictEqual({ max: [1, 1, 1], min: [0, 0, 0] })
    }),
  )
})
