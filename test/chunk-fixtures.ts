import { ChunkBlocks as chunkBlocks, ChunkHeight as chunkHeight } from '@nerima-games/mc-kernel'
import { blockIndex, blocksPerChunk, type ChunkView } from '../src/domain/chunk-view'

export const TEST_HEIGHT = 256
export const TEST_BLOCKS_PER_CHUNK = blocksPerChunk(TEST_HEIGHT)

export const testBlockIndex = (lx: number, y: number, lz: number): number =>
  blockIndex(lx, y, lz, TEST_HEIGHT)

export const testChunk = (blocks: Uint8Array, fluid?: ChunkView['fluid']): ChunkView =>
  fluid
    ? { blocks: chunkBlocks(TEST_HEIGHT, blocks), fluid, height: chunkHeight(TEST_HEIGHT) }
    : { blocks: chunkBlocks(TEST_HEIGHT, blocks), height: chunkHeight(TEST_HEIGHT) }
