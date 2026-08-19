import { createHash } from 'node:crypto'
import { blockIdOf, type BlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it } from './effect-test.js'
import {
  blockIndex,
  type ChunkView,
} from '../src/domain/chunk-view'
import { meshChunk } from '../src/domain/mesh'
import type { MeshConfig } from '../src/domain/opacity'
import { packMeshLayers, type PackedMeshBuffers } from '../src/domain/mesh-buffers'
import { railShapeCodeOf } from '../src/domain/rail-types'

const CHUNK_HEIGHT = 4
const STONE = blockIdOf('stone')
const WATER = blockIdOf('water')
const GLASS = blockIdOf('glass')
const DANDELION = blockIdOf('dandelion')
const CACTUS = blockIdOf('cactus')
const STONE_SLAB = blockIdOf('stone_slab')
const RAIL = blockIdOf('rail')

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

const chunkOf = (cells: ReadonlyArray<Cell>): ChunkView => {
  const cellCount = 16 * CHUNK_HEIGHT * 16
  const blocks = new Uint8Array(cellCount)
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
})
