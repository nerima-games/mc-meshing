import { type ChunkView, blockCountOf } from './chunk-view.js'
import type { Chunk as KernelChunk } from '@nerima-games/mc-kernel'

/**
 * Convert the kernel's variable-height column into the meshing view without
 * truncating or padding its storage.
 */
export const chunkViewOf = (chunk: KernelChunk): ChunkView => {
  const blocks = new Uint8Array(blockCountOf(chunk.height))
  chunk.blocks.copyTo(blocks)
  return { blocks, height: chunk.height }
}
