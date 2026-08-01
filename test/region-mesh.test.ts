import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCKS_PER_CHUNK, blockIndex, emptyChunk, type ChunkView } from '../src/domain/chunk-view'
import { meshChunkNaive, meshChunkRegion, type MeshLayers, type MeshRegion } from '../src/domain/mesh'
import { MESH_LAYERS, type MeshConfig } from '../src/domain/opacity'

const STONE = 1
const WATER = 2
const FLOWER = 3
const CONFIG: MeshConfig = {
  waterBlockIds: new Set([WATER]),
  transparentSolidBlockIds: new Set(),
  crossPlantBlockIds: new Set([FLOWER]),
  fluidMaxLevels: new Map([[WATER, 8]]),
}

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [x, y, z, id] of cells) blocks[blockIndex(x, y, z)] = id
  return { blocks }
}

const inRegion = (region: MeshRegion, x: number, y: number, z: number): boolean =>
  x >= region.min[0] && x < region.max[0] && y >= region.min[1] && y < region.max[1] && z >= region.min[2] && z < region.max[2]

const origin = (vertices: ReadonlyArray<readonly [number, number, number]>): readonly [number, number, number] => [
  Math.floor(Math.min(...vertices.map(([x]) => x))),
  Math.floor(Math.min(...vertices.map(([, y]) => y))),
  Math.floor(Math.min(...vertices.map(([, , z]) => z))),
]

const project = (layers: MeshLayers, region: MeshRegion): MeshLayers => ({
  opaque: layers.opaque.filter((q) => inRegion(region, q.lx, q.y, q.lz)),
  water: layers.water.filter((q) => inRegion(region, q.lx, q.y, q.lz)),
  transparentSolid: layers.transparentSolid.filter((q) => inRegion(region, q.lx, q.y, q.lz)),
  crossPlants: layers.crossPlants.filter((q) => inRegion(region, ...origin(q.vertices))),
  fluids: layers.fluids.filter((q) => inRegion(region, ...origin(q.vertices))),
})

describe('subregion meshing', () => {
  it.effect('expands a dirty AABB by one cell and matches the corresponding naive cells', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [7, 20, 8, STONE], [8, 20, 8, STONE], [9, 20, 8, STONE],
        [8, 21, 8, FLOWER], [8, 19, 8, WATER], [12, 20, 8, STONE],
      ])
      const result = meshChunkRegion(chunk, {}, CONFIG, { min: [8, 20, 8], max: [9, 21, 9] })
      expect(result.ownedRegion).toStrictEqual({ min: [7, 19, 7], max: [10, 22, 10] })
      expect(result.layers).toStrictEqual(project(meshChunkNaive(chunk, {}, CONFIG), result.ownedRegion))
      expect(meshChunkRegion(chunk, {}, CONFIG, result.dirtyRegion)).toStrictEqual(result)
    }),
  )

  it.effect('clamps the halo at a chunk boundary while consulting the neighbour for faces and AO', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[15, 40, 8, STONE]])
      const xPos = chunkWith([[0, 40, 8, STONE], [0, 41, 8, STONE]])
      const result = meshChunkRegion(chunk, { xPos }, CONFIG, { min: [15, 40, 8], max: [16, 41, 9] })
      expect(result.ownedRegion).toStrictEqual({ min: [14, 39, 7], max: [16, 42, 10] })
      expect(result.layers).toStrictEqual(project(meshChunkNaive(chunk, { xPos }, CONFIG), result.ownedRegion))
      expect(result.layers.opaque.some((quad) => quad.direction === 'xPos')).toBe(false)
    }),
  )

  it.effect('returns owned empty buffers for an empty or reversed region', () =>
    Effect.sync(() => {
      const result = meshChunkRegion(emptyChunk(), {}, CONFIG, { min: [9, 9, 9], max: [4, 4, 4] })
      expect(result.dirtyRegion).toStrictEqual({ min: [9, 9, 9], max: [9, 9, 9] })
      expect(result.ownedRegion).toStrictEqual(result.dirtyRegion)
      expect(MESH_LAYERS.every((layer) => result.layers[layer].length === 0)).toBe(true)
      expect(result.layers.crossPlants).toStrictEqual([])
      expect(result.layers.fluids).toStrictEqual([])
    }),
  )
})
