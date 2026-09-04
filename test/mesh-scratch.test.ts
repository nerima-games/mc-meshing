import { describe, expect, it } from 'vitest'
import { chunkCoord } from '@nerima-games/mc-kernel'
import {
  CHUNK_SIZE,
  blockIndex,
  type ChunkView,
} from '../src/domain/chunk-view'
import { meshChunk } from '../src/domain/mesh'
import { createMeshScratch, MeshScratch } from '../src/domain/mesh-scratch'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity'

const sampleChunk = (light?: ChunkView['light']): ChunkView => {
  const height = 4
  const blocks = new Uint16Array(CHUNK_SIZE * height * CHUNK_SIZE)
  blocks[blockIndex(1, 1, 1, height)] = 1
  return light ? { blocks, coord: chunkCoord(0, 0), height, light } : { blocks, coord: chunkCoord(0, 0), height }
}

describe('mesh scratch workspace', () => {
  it('reuses each workspace and grows it when a larger request arrives', () => {
    const scratch = createMeshScratch()
    expect(scratch).toBeInstanceOf(MeshScratch)

    const first = scratch.buffersFor(4, false)
    const sameSize = scratch.buffersFor(4, false)
    expect(sameSize.mask).toBe(first.mask)
    expect(sameSize.light).toBeUndefined()

    const withLight = scratch.buffersFor(8, true)
    expect(withLight.mask).not.toBe(first.mask)
    expect(withLight.light?.block).toHaveLength(8)
    expect(withLight.light?.sky).toHaveLength(8)

    const sameLitSize = scratch.buffersFor(8, true)
    expect(sameLitSize.mask).toBe(withLight.mask)
    expect(sameLitSize.light?.block).toBe(withLight.light?.block)
    expect(sameLitSize.light?.sky).toBe(withLight.light?.sky)
  })

  it('rejects invalid buffer lengths', () => {
    const scratch = createMeshScratch()

    expect(() => scratch.buffersFor(-1, false)).toThrow(RangeError)
    expect(() => scratch.buffersFor(1.5, false)).toThrow(RangeError)
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
