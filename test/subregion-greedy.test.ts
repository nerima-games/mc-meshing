import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result } from 'effect'
import { ChunkAxis as chunkAxis, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { type BlockId } from '../src/domain/block-data'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, type ChunkView, blockIndex } from '../src/domain/chunk-view'
import { type QuadAxis, tangentAxes } from '../src/domain/faces'
import { meshChunkRegion } from '../src/domain/mesh'
import { EMPTY_MESH_CONFIG, MESH_LAYERS, type MeshConfig } from '../src/domain/opacity'
import type { MeshLayers, MeshRegion, Quad } from '../src/domain/mesh-types'

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const STONE: BlockId = Option.getOrThrow(blockIdOf('stone'))
const HEIGHT = CHUNK_HEIGHT
const CONFIG: MeshConfig = EMPTY_MESH_CONFIG

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, BlockId]>): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz, HEIGHT)] = blockId
  }
  return { blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height: HEIGHT }
}

const positionAt = (quad: Quad, alongWidth: number, alongHeight: number): readonly [number, number, number] => {
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const coordinate = (axis: QuadAxis): number => {
    const origin = axis === 'x' ? quad.lx : axis === 'y' ? quad.y : quad.lz
    return origin + (axis === widthAxis ? alongWidth : axis === heightAxis ? alongHeight : 0)
  }
  return [coordinate('x'), coordinate('y'), coordinate('z')]
}

const isInside = (region: MeshRegion, [x, y, z]: readonly [number, number, number]): boolean =>
  x >= region.min[0] && x < region.max[0] &&
  y >= region.min[1] && y < region.max[1] &&
  z >= region.min[2] && z < region.max[2]

const everyCubeFaceCellIsInside = (layers: MeshLayers, region: MeshRegion): boolean =>
  MESH_LAYERS.every((layer) =>
    layers[layer].every((quad: Quad) => {
      for (let alongWidth = 0; alongWidth < quad.width; alongWidth += 1) {
        for (let alongHeight = 0; alongHeight < quad.height; alongHeight += 1) {
          if (!isInside(region, positionAt(quad, alongWidth, alongHeight))) {
            return false
          }
        }
      }
      return true
    }),
  )

describe('dirty AABB greedy meshing', () => {
  it.effect('merges coplanar cells inside the dirty region and emits no halo cells', () =>
    Effect.sync(() => {
      const cells: Array<readonly [number, number, number, BlockId]> = []
      for (let lx = 8; lx < 11; lx += 1) {
        for (let lz = 8; lz < 11; lz += 1) {
          cells.push([lx, 64, lz, STONE])
        }
      }
      const chunk = chunkWith(cells)
      const dirtyRegion: MeshRegion = { min: [8, 64, 8], max: [11, 65, 11] }
      const result = expectSuccess(meshChunkRegion(chunk, {}, CONFIG, dirtyRegion))

      expect(result.dirtyRegion).toStrictEqual(dirtyRegion)
      expect(result.ownedRegion).toStrictEqual(dirtyRegion)
      expect(everyCubeFaceCellIsInside(result.layers, dirtyRegion)).toBe(true)
      const topFaces = result.layers.opaque.filter((quad) => quad.direction === 'yPos')
      expect(topFaces).toHaveLength(1)
      expect(topFaces[0]).toMatchObject({ lx: 8, y: 64, lz: 8, width: 3, height: 3 })
    }),
  )

  it.effect('reads cells outside the dirty AABB to hide faces without emitting them', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [8, 64, 8, STONE],
        [9, 64, 8, STONE],
        [10, 64, 8, STONE],
      ])
      const dirtyRegion: MeshRegion = { min: [8, 64, 8], max: [10, 65, 9] }
      const result = expectSuccess(meshChunkRegion(chunk, {}, CONFIG, dirtyRegion))

      expect(result.layers.opaque.some((quad) => quad.direction === 'xPos')).toBe(false)
      expect(everyCubeFaceCellIsInside(result.layers, dirtyRegion)).toBe(true)
      expect(result.layers.opaque.some((quad) => quad.lx === 10)).toBe(false)
    }),
  )
})
