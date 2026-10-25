import { createHash } from 'node:crypto'
import { Option, Result } from 'effect'
import { ChunkAxis as chunkAxis, blockIdOf, chunkCoord, type BlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'
import {
  blockIndex,
  type ChunkView,
} from '../src/domain/chunk-view'
import { simplifyMesh } from '../src/domain/lod'
import { type MeshLayers, meshChunk as meshChunkResult } from '../src/domain/mesh'
import type { MeshConfig } from '../src/domain/opacity'
import { packMeshLayers, type PackedMeshBuffers } from '../src/domain/mesh-buffers'
import { railShapeCodeOf } from '../src/domain/rail-types'

const CHUNK_HEIGHT = 4
const STONE = Option.getOrThrow(blockIdOf('stone'))
const WATER = Option.getOrThrow(blockIdOf('water'))
const GLASS = Option.getOrThrow(blockIdOf('glass'))
const DANDELION = Option.getOrThrow(blockIdOf('dandelion'))
const CACTUS = Option.getOrThrow(blockIdOf('cactus'))
const STONE_SLAB = Option.getOrThrow(blockIdOf('stone_slab'))
const RAIL = Option.getOrThrow(blockIdOf('rail'))

type Cell = {
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly blockId: BlockId
  readonly level?: number
  readonly source?: boolean
  readonly falling?: boolean
  readonly railShape?: number
}

const CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set([DANDELION]),
  fluidMaxLevels: new Map([[WATER, 7]]),
  transparentSolidBlockIds: new Set([GLASS]),
  waterBlockIds: new Set([WATER]),
}

const meshChunk = (...args: Parameters<typeof meshChunkResult>) => {
  const result = meshChunkResult(...args)
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected mesh failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const chunkOf = (cells: ReadonlyArray<Cell>): ChunkView => {
  const cellCount = 16 * CHUNK_HEIGHT * 16
  const blocks = new Uint16Array(cellCount)
  const levels = new Uint8Array(cellCount)
  const sources = new Uint8Array(cellCount)
  const falling = new Uint8Array(cellCount)
  const railShapes = new Uint8Array(cellCount)

  for (const cell of cells) {
    const index = blockIndex(cell.lx, cell.y, cell.lz, CHUNK_HEIGHT)
    blocks[index] = cell.blockId
    levels[index] = cell.level ?? 0
    sources[index] = cell.source === true ? 1 : 0
    falling[index] = cell.falling === true ? 1 : 0
    if (typeof cell.railShape === 'number') {
      railShapes[index] = cell.railShape
    }
  }

  return {
    blocks,
    coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
    fluid: { falling, levels, sources },
    height: CHUNK_HEIGHT,
    railShapes,
  }
}

const mergedCubeFixture = (): ChunkView => {
  const cells: Array<Cell> = []
  for (let lx = 2; lx < 6; lx += 1) {
    for (let lz = 2; lz < 5; lz += 1) {
      cells.push({ blockId: STONE, lx, lz, y: 1 })
    }
  }
  return chunkOf(cells)
}

const kernelShapeFixture = (): ChunkView =>
  chunkOf([
    { blockId: STONE, lx: 1, lz: 1, y: 1 },
    { blockId: STONE, lx: 2, lz: 1, y: 1 },
    { blockId: GLASS, lx: 4, lz: 1, y: 1 },
    { blockId: DANDELION, lx: 6, lz: 1, y: 1 },
    { blockId: WATER, falling: true, level: 0, lx: 8, lz: 1, source: true, y: 1 },
    { blockId: WATER, falling: true, level: 1, lx: 8, lz: 1, y: 2 },
    { blockId: CACTUS, lx: 10, lz: 1, y: 1 },
    { blockId: STONE_SLAB, lx: 12, lz: 1, y: 1 },
    {
      blockId: RAIL,
      lx: 14,
      lz: 1,
      railShape: railShapeCodeOf('ascending_east'),
      y: 1,
    },
  ])

const migrationParityFixture = (): ChunkView =>
  chunkOf([
    { blockId: STONE, lx: 1, lz: 1, y: 1 },
    { blockId: STONE, lx: 2, lz: 1, y: 1 },
    { blockId: STONE, lx: 1, lz: 2, y: 1 },
    { blockId: STONE, lx: 2, lz: 2, y: 1 },
    { blockId: GLASS, lx: 5, lz: 1, y: 1 },
    { blockId: STONE, lx: 6, lz: 1, y: 1 },
    { blockId: STONE, lx: 8, lz: 8, y: 1 },
    { blockId: STONE, lx: 9, lz: 9, y: 1 },
    { blockId: WATER, lx: 10, lz: 2, source: true, y: 1 },
    { blockId: WATER, falling: true, level: 1, lx: 10, lz: 2, y: 2 },
  ])

const digestOf = (buffers: PackedMeshBuffers): string => {
  const canonical = JSON.stringify({
    ambientOcclusion: Array.from(buffers.ambientOcclusion),
    blockIds: Array.from(buffers.blockIds),
    blockLight: Array.from(buffers.blockLight),
    groups: buffers.groups,
    indices: Array.from(buffers.indices),
    normals: Array.from(buffers.normals),
    positions: Array.from(buffers.positions),
    skyLight: Array.from(buffers.skyLight),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

const quadSequenceDigestOf = (layers: MeshLayers): string =>
  createHash('sha256').update(JSON.stringify(layers)).digest('hex')

const GOLDEN_HASHES = {
  'merged-cubes': '4c1b29af0058f1c8e541b9b664440860e3b0c38a9057374ed8daaf547f3a3375',
  'kernel-shapes': '3d2e8e2c971daf4d4ed4ccd167a533b152a217d2d69c419a2e28602bb6b78cde',
} as const

const FIXTURES = [
  ['merged-cubes', mergedCubeFixture],
  ['kernel-shapes', kernelShapeFixture],
] as const

describe('packed mesh golden fixtures', () => {
  for (const [name, makeChunk] of FIXTURES) {
    it(`${name} keeps geometry buffers and draw groups stable`, () => {
      const layers = meshChunk(makeChunk(), {}, CONFIG)
      const buffers = packMeshLayers(layers)

      expect(buffers.positions.length).toBeGreaterThan(0)
      expect(buffers.indices.length).toBeGreaterThan(0)
      expect(buffers.groups.some(({ vertexCount }) => vertexCount > 0)).toBe(true)
      expect(digestOf(buffers)).toBe(GOLDEN_HASHES[name])
    })
  }

  it('keeps meshChunk and simplifyMesh quad sequences stable across the Effect 4 migration', () => {
    const layers = meshChunk(migrationParityFixture(), {}, CONFIG)

    expect(layers.opaque.length).toBeGreaterThan(0)
    expect(layers.transparentSolid.length).toBeGreaterThan(0)
    expect(layers.fluids.length).toBeGreaterThan(0)
    expect(layers.opaque.some((quad) => quad.ao > 0)).toBe(true)
    expect(quadSequenceDigestOf(layers)).toBe('a05597e98b9185f89928a80fbabecd9aefa4a4066708c3b337b18a331d3b81af')
    expect(quadSequenceDigestOf(simplifyMesh(layers, 1))).toBe('d0e074f1b850d2565808da03cd6c2ac4b658c56ee444133997db1fb2b9a3e058')
    expect(quadSequenceDigestOf(simplifyMesh(layers, 2))).toBe('a514616b4981b301c7da4e965b95b137d5a5ea6546392640c53d8d37e00da354')
  })
})
