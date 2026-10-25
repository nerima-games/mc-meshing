import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result } from 'effect'
import { ChunkAxis as chunkAxis, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, CHUNK_SIZE, type ChunkView, blockIndex } from '../src/domain/chunk-view'
import { VERTICES_PER_QUAD } from '../src/domain/faces'
import { meshChunkNaive } from '../src/domain/mesh'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity'
import { simplifyMesh } from '../src/domain/lod'

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const STONE = Option.getOrThrow(blockIdOf('stone'))

const slab = (): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      blocks[blockIndex(lx, 64, lz, CHUNK_HEIGHT)] = STONE
    }
  }
  return { blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height: CHUNK_HEIGHT }
}

const opaqueVertexCount = (layers: { readonly opaque: ReadonlyArray<unknown> }): number =>
  layers.opaque.length * VERTICES_PER_QUAD

describe('LOD vertex ratios', () => {
  it.effect('keeps the reference 16x16x1 slab ratios within FR-3.1 tolerances', () =>
    Effect.sync(() => {
      const lod0 = expectSuccess(meshChunkNaive(slab(), {}, EMPTY_MESH_CONFIG))
      const baselineVertices = opaqueVertexCount(lod0)
      expect(baselineVertices).toBeGreaterThan(0)

      const lod1Ratio = opaqueVertexCount(simplifyMesh(lod0, 1)) / baselineVertices
      const lod2Ratio = opaqueVertexCount(simplifyMesh(lod0, 2)) / baselineVertices

      expect(lod1Ratio).toBeGreaterThanOrEqual(0.25)
      expect(lod1Ratio).toBeLessThanOrEqual(0.30)
      expect(lod2Ratio).toBeGreaterThanOrEqual(0.06)
      expect(lod2Ratio).toBeLessThanOrEqual(0.10)
    }),
  )
})
