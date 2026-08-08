/* oxlint-disable sort-imports */
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, CHUNK_SIZE, blockIndex } from '../src/domain/chunk-view'
import { chunkViewOf } from '../src/domain/kernel-adapter'
import { type Chunk as KernelChunk, blockIdOf, chunk, chunkCoord } from '@nerima-games/mc-kernel'
import { describe, expect, it } from '@effect/vitest'

const FIRST_INDEX = 0
const STEP = 1
const SECOND_CHUNK_X = 2
const NEGATIVE_CHUNK_Z = -1
const STONE_X = 3
const STONE_Z = 5
const STONE_Y = 42
const EDGE_X = CHUNK_SIZE - STEP
const EDGE_Z = FIRST_INDEX
const EDGE_Y = CHUNK_HEIGHT - STEP

describe('chunkViewOf', () => {
  it('preserves kernel column storage in the meshing layout', () => {
    const source = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT)
    const stone = blockIdOf('stone')
    source[(STONE_X * CHUNK_SIZE + STONE_Z) * CHUNK_HEIGHT + STONE_Y] = stone
    source[(EDGE_X * CHUNK_SIZE + EDGE_Z) * CHUNK_HEIGHT + EDGE_Y] = stone

    const view = chunkViewOf(chunk(chunkCoord(SECOND_CHUNK_X, NEGATIVE_CHUNK_Z), CHUNK_HEIGHT, source))

    expect(view.blocks).toHaveLength(BLOCKS_PER_CHUNK)
    expect(view.blocks[blockIndex(STONE_X, STONE_Y, STONE_Z)]).toBe(stone)
    expect(view.blocks[blockIndex(EDGE_X, EDGE_Y, EDGE_Z)]).toBe(stone)
    expect(view.blocks[blockIndex(FIRST_INDEX, FIRST_INDEX, FIRST_INDEX)]).toBe(FIRST_INDEX)
  })

  it('rejects a kernel chunk with a non-meshing height', () => {
    const height = CHUNK_HEIGHT - STEP
    const source = chunk(chunkCoord(FIRST_INDEX, FIRST_INDEX), height, new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * height))

    expect(() => chunkViewOf(source)).toThrow(/requires a 256-block chunk/)
  })

  it('reads a cell past the end of a shorter-than-declared blocks array as air', () => {
    // `chunk()`'s own validation (`assertBlocks`) never lets `blocks.length`
    // Disagree with `height`, but `KernelChunk` is a plain structural type, not
    // Branded to the smart constructor — `chunkViewOf` receives the TYPE, and
    // Nothing stops a hand-built value (a decoded-but-unvalidated source, or, as
    // Here, a direct literal) from disagreeing. `?? AIR_BLOCK_ID` is this
    // Boundary's answer, the same one `domain/fluid-mesh.ts`'s `levelIn` gives
    // For the identically-shaped `FluidView` boundary.
    const source: KernelChunk = {
      blocks: new Uint8Array(STEP),
      coord: chunkCoord(FIRST_INDEX, FIRST_INDEX),
      height: CHUNK_HEIGHT,
    }

    const view = chunkViewOf(source)

    expect(view.blocks[blockIndex(EDGE_X, EDGE_Y, EDGE_Z)]).toBe(FIRST_INDEX)
  })
})
