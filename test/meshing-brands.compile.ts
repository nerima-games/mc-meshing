import { BlockId as blockIdOf, ChunkAxis as chunkAxis, LocalAxis as localAxis } from '@nerima-games/mc-kernel'
import type { ChunkCoord, ChunkView, Quad } from '../src/index.js'

const local = localAxis(0)
const blockId = blockIdOf(1)

export const validChunkView: ChunkView = {
  coord: { cx: chunkAxis(0), cz: chunkAxis(0) },
  height: 1,
  blocks: new Uint16Array(16 * 16),
}

export const validQuad: Pick<Quad, 'blockId'> = { blockId }

// @ts-expect-error ChunkView coordinates use kernel ChunkAxis, not LocalAxis.
export const localAxisAsChunkCoord: ChunkCoord = { cx: local, cz: local }

// @ts-expect-error A plain number is not the kernel BlockId brand in a public Quad.
export const rawNumberAsBlockId: Pick<Quad, 'blockId'> = { blockId: 1 }
