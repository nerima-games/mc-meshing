import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { type ChunkView, blockIndex } from '../src/domain/chunk-view'
import { type MeshLayers, meshChunk } from '../src/domain/mesh'
import { TEST_BLOCKS_PER_CHUNK, TEST_HEIGHT, testChunk } from './chunk-fixtures'

const STONE = blockIdOf('stone')
const GLASS = blockIdOf('glass')
const WATER = blockIdOf('water')
const CACTUS = blockIdOf('cactus')
const RAIL = blockIdOf('rail')
const LILY_PAD = blockIdOf('lily_pad')
const DANDELION = blockIdOf('dandelion')
const STONE_SLAB = blockIdOf('stone_slab')
const PRESSURE_PLATE = blockIdOf('pressure_plate')

const GOLDEN_FIXTURE = 'canonical-sparse-minecraft'
const GOLDEN_URL = new URL('./golden/mesh-goldens.json', import.meta.url)

type MeshGolden = {
  readonly fixture: string
  readonly serialization: string
  readonly sha256: string
}

const setBlock = (blocks: Uint8Array, lx: number, y: number, lz: number, blockId: number): void => {
  blocks[blockIndex(lx, y, lz, TEST_HEIGHT)] = blockId
}

const goldenChunk = (): ChunkView => {
  const blocks = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  const levels = new Uint8Array(TEST_BLOCKS_PER_CHUNK)
  const sources = new Uint8Array(TEST_BLOCKS_PER_CHUNK)

  setBlock(blocks, 1, 64, 1, STONE)
  setBlock(blocks, 3, 64, 1, GLASS)
  setBlock(blocks, 5, 64, 1, DANDELION)
  setBlock(blocks, 7, 64, 1, CACTUS)
  setBlock(blocks, 9, 64, 1, RAIL)
  setBlock(blocks, 11, 64, 1, LILY_PAD)
  setBlock(blocks, 1, 64, 4, STONE_SLAB)
  setBlock(blocks, 4, 64, 4, PRESSURE_PLATE)
  setBlock(blocks, 13, 63, 13, WATER)
  const waterIndex = blockIndex(13, 63, 13, TEST_HEIGHT)
  sources[waterIndex] = 1

  return testChunk(blocks, { levels, sources })
}

const canonicalMesh = (layers: MeshLayers): string =>
  JSON.stringify({
    crossPlants: layers.crossPlants,
    fluids: layers.fluids,
    opaque: layers.opaque,
    specials: layers.specials,
    transparentSolid: layers.transparentSolid,
    water: layers.water,
  })

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('deterministic mesh golden', () => {
  it.effect('matches the checked-in canonical mesh serialization', () =>
    Effect.sync(() => {
      const golden = JSON.parse(readFileSync(GOLDEN_URL, 'utf8')) as MeshGolden
      const serialized = canonicalMesh(meshChunk(goldenChunk(), {}))

      expect(golden.fixture).toBe(GOLDEN_FIXTURE)
      expect(golden.serialization).toBe('MeshLayers JSON with canonical property order')
      expect(sha256(serialized)).toBe(golden.sha256)
    }),
  )
})
