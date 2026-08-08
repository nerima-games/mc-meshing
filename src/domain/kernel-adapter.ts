import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, CHUNK_SIZE, type ChunkView, blockIndex } from './chunk-view'
import type { Chunk as KernelChunk } from '@nerima-games/mc-kernel'

const FIRST_INDEX = 0
const STEP = 1
const AIR_BLOCK_ID = 0

/**
 * Convert the kernel's variable-height column into meshing's fixed-height view.
 * Meshing does not silently truncate or pad worlds with a different height.
 */
export const chunkViewOf = (chunk: KernelChunk): ChunkView => {
  if (chunk.height !== CHUNK_HEIGHT) {
    throw new RangeError(`Meshing requires a ${CHUNK_HEIGHT}-block chunk, received ${chunk.height}`)
  }

  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (let localX = FIRST_INDEX; localX < CHUNK_SIZE; localX += STEP) {
    for (let localZ = FIRST_INDEX; localZ < CHUNK_SIZE; localZ += STEP) {
      const sourceColumnStart = (localX * CHUNK_SIZE + localZ) * chunk.height
      for (let localY = FIRST_INDEX; localY < CHUNK_HEIGHT; localY += STEP) {
        blocks[blockIndex(localX, localY, localZ)] = chunk.blocks[sourceColumnStart + localY] ?? AIR_BLOCK_ID
      }
    }
  }
  return { blocks }
}
