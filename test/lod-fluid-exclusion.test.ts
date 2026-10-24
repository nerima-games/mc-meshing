import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result } from 'effect'
import { ChunkAxis as chunkAxis, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, type ChunkView, blockIndex } from '../src/domain/chunk-view'
import { meshChunkNaive } from '../src/domain/mesh'
import { simplifyMesh } from '../src/domain/lod'
import type { MeshConfig } from '../src/domain/opacity'

const STONE = Option.getOrThrow(blockIdOf('stone'))
const DIRT = Option.getOrThrow(blockIdOf('dirt'))
const GLASS = Option.getOrThrow(blockIdOf('glass'))
const WATER = Option.getOrThrow(blockIdOf('water'))
const DANDELION = Option.getOrThrow(blockIdOf('dandelion'))
const CACTUS = Option.getOrThrow(blockIdOf('cactus'))

const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([DANDELION]),
  fluidMaxLevels: new Map([[WATER, 7]]),
  transparentSolidBlockIds: new Set([GLASS]),
  waterBlockIds: new Set([WATER, DIRT]),
}

const chunkWith = (): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  const cells: ReadonlyArray<readonly [number, typeof STONE]> = [
    [0, STONE],
    [1, STONE],
    [4, DIRT],
    [6, GLASS],
    [8, DANDELION],
    [10, WATER],
    [12, CACTUS],
  ]
  for (const [lx, blockId] of cells) {
    blocks[blockIndex(lx, 64, 4, CHUNK_HEIGHT)] = blockId
  }
  return { blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height: CHUNK_HEIGHT }
}

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

describe('LOD companion-layer pass-through', () => {
  it.effect('simplifies opaque faces and preserves every other layer array by identity', () =>
    Effect.sync(() => {
      const lod0 = expectSuccess(meshChunkNaive(chunkWith(), {}, CONFIG))
      const lod1 = simplifyMesh(lod0, 1)

      expect(lod0.opaque.length).toBeGreaterThan(lod1.opaque.length)
      expect(lod1.opaque).not.toBe(lod0.opaque)
      expect(lod0.water.length).toBeGreaterThan(0)
      expect(lod0.transparentSolid.length).toBeGreaterThan(0)
      expect(lod0.crossPlants.length).toBeGreaterThan(0)
      expect(lod0.fluids.length).toBeGreaterThan(0)
      expect(lod0.specialBlocks.length).toBeGreaterThan(0)
      expect(lod1.water).toBe(lod0.water)
      expect(lod1.transparentSolid).toBe(lod0.transparentSolid)
      expect(lod1.crossPlants).toBe(lod0.crossPlants)
      expect(lod1.fluids).toBe(lod0.fluids)
      expect(lod1.specialBlocks).toBe(lod0.specialBlocks)
    }),
  )
})
