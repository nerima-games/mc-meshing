import { describe, expect, it } from 'vitest'
import { Option, Result } from 'effect'
import * as FastCheck from 'fast-check'
import { ChunkAxis as chunkAxis, blockIdOf, chunkCoord, encodeBlockState } from '@nerima-games/mc-kernel'
import {
  CHUNK_SIZE,
  blockIndex,
  type ChunkView,
} from '../src/domain/chunk-view'
import { meshChunk as meshChunkResult } from '../src/domain/mesh'
import { createMeshScratch, MeshScratch } from '../src/domain/mesh-scratch'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity'

const sampleChunk = (light?: ChunkView['light']): ChunkView => {
  const height = 4
  const blocks = new Uint16Array(CHUNK_SIZE * height * CHUNK_SIZE)
  blocks[blockIndex(1, 1, 1, height)] = 1
  const coord = chunkCoord(chunkAxis(0), chunkAxis(0))
  return light ? { blocks, coord, height, light } : { blocks, coord, height }
}

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const sampleChunkWithLogAxis = (axis: 'x' | 'y' | 'z'): ChunkView => {
  const height = 4
  const blocks = new Uint16Array(CHUNK_SIZE * height * CHUNK_SIZE)
  const blockStates = new Uint32Array(blocks.length)
  const index = blockIndex(1, 1, 1, height)
  const logId = Option.getOrThrow(blockIdOf('oak_log'))
  blocks[index] = logId
  blockStates[index] = expectSuccess(encodeBlockState(logId, { axis }))
  return { blocks, blockStates, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height }
}

const meshChunk = (...args: Parameters<typeof meshChunkResult>) => expectSuccess(meshChunkResult(...args))

describe('mesh scratch workspace', () => {
  it('reuses each workspace and grows it when a larger request arrives', () => {
    const scratch = createMeshScratch()
    expect(scratch).toBeInstanceOf(MeshScratch)

    const first = expectSuccess(scratch.buffersFor(4, false))
    const sameSize = expectSuccess(scratch.buffersFor(4, false))
    expect(sameSize.mask).toBe(first.mask)
    expect(sameSize.light).toBeUndefined()

    const withLight = expectSuccess(scratch.buffersFor(8, true))
    expect(withLight.mask).not.toBe(first.mask)
    expect(withLight.light?.block).toHaveLength(8)
    expect(withLight.light?.sky).toHaveLength(8)

    const sameLitSize = expectSuccess(scratch.buffersFor(8, true))
    expect(sameLitSize.mask).toBe(withLight.mask)
    expect(sameLitSize.light?.block).toBe(withLight.light?.block)
    expect(sameLitSize.light?.sky).toBe(withLight.light?.sky)
  })

  it('rejects invalid buffer lengths', () => {
    const scratch = createMeshScratch()

    expect(scratch.buffersFor(-1, false)).toStrictEqual(
      Result.fail({ _tag: 'InvalidMeshScratchLength', required: -1 }),
    )
    expect(scratch.buffersFor(1.5, false)).toStrictEqual(
      Result.fail({ _tag: 'InvalidMeshScratchLength', required: 1.5 }),
    )
  })

  it('allocates and reuses a block-state mask only for stateful chunks', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: 64 }), (required) => {
        const scratch = createMeshScratch()
        const first = expectSuccess(scratch.buffersFor(required, false, true))
        const repeated = expectSuccess(scratch.buffersFor(required, false, true))
        const stateless = expectSuccess(scratch.buffersFor(required, false))

        expect(first.blockStateMask).toHaveLength(required)
        expect(repeated.blockStateMask).toBe(first.blockStateMask)
        expect(stateless.blockStateMask).toBeUndefined()
      }),
      { numRuns: 80 },
    )
  })

  it('keeps cold and reusable meshing equivalent without aliasing output', () => {
    const scratch = createMeshScratch()
    const chunk = sampleChunk()
    const cold = meshChunk(chunk, {}, EMPTY_MESH_CONFIG)
    const warm = meshChunk(chunk, {}, EMPTY_MESH_CONFIG, scratch)
    const snapshot = JSON.stringify(warm)

    expect(warm).toStrictEqual(cold)

    meshChunk(sampleChunk(), {}, EMPTY_MESH_CONFIG, scratch)
    expect(JSON.stringify(warm)).toBe(snapshot)
  })

  it('reuses the state mask across chunks with different model selectors', () => {
    const scratch = createMeshScratch()
    const firstChunk = sampleChunkWithLogAxis('x')
    const secondChunk = sampleChunkWithLogAxis('z')
    const firstCold = meshChunk(firstChunk, {}, EMPTY_MESH_CONFIG)
    const secondCold = meshChunk(secondChunk, {}, EMPTY_MESH_CONFIG)
    const firstWarm = meshChunk(firstChunk, {}, EMPTY_MESH_CONFIG, scratch)
    const firstSnapshot = JSON.stringify(firstWarm)
    const secondWarm = meshChunk(secondChunk, {}, EMPTY_MESH_CONFIG, scratch)

    expect(firstWarm).toStrictEqual(firstCold)
    expect(secondWarm).toStrictEqual(secondCold)
    expect(JSON.stringify(firstWarm)).toBe(firstSnapshot)
  })

  it('reuses light workspaces while preserving sampled light', () => {
    const light = {
      blockLight: new Uint8Array(4 * 16 * 16).fill(7),
      skyLight: new Uint8Array(4 * 16 * 16).fill(13),
    }
    const chunk = sampleChunk(light)
    const scratch = createMeshScratch()

    const cold = meshChunk(chunk, {}, EMPTY_MESH_CONFIG)
    const warm = meshChunk(chunk, {}, EMPTY_MESH_CONFIG, scratch)
    const repeated = meshChunk(chunk, {}, EMPTY_MESH_CONFIG, scratch)

    expect(warm).toStrictEqual(cold)
    expect(repeated).toStrictEqual(cold)
  })
})
