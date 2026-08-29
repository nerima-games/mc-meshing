import {
  AIR_BLOCK_ID,
  CHUNK_SIZE_XZ,
  type Chunk as KernelChunk,
  ChunkBlocks as chunkBlocks,
  ChunkHeight as chunkHeight,
} from '@nerima-games/mc-kernel'

/** Horizontal extent of a chunk, in blocks. */
export const CHUNK_SIZE = CHUNK_SIZE_XZ

/** The block id that means "nothing here". */
export const AIR = AIR_BLOCK_ID

/** Number of block ids in a chunk with the given vertical extent. */
export const blocksPerChunk = (height: number): number => CHUNK_SIZE * height * CHUNK_SIZE

/**
 * Block storage layout: `y + lz * height + lx * height * CHUNK_SIZE`.
 *
 * This is the same layout used by `mc-kernel`'s `Chunk`, so a kernel chunk can
 * be passed to the mesher directly.
 */
export const blockIndex = (lx: number, y: number, lz: number, height: number): number =>
  y + lz * height + lx * height * CHUNK_SIZE

/** The fluid state needed by the mesher, decoded by the simulation owner. */
export type FluidView = {
  /** Fill level per cell. `0` is full; larger values are lower. */
  readonly levels: Readonly<Uint8Array>
  /** Non-zero where the cell is a fluid source. */
  readonly sources: Readonly<Uint8Array>
  /** Non-zero where the fluid is falling vertically. */
  readonly falling?: Readonly<Uint8Array>
}

/**
 * Renderer-owned additions to the kernel chunk shape.
 *
 * `KernelChunk` is structurally assignable to this type. The mesher therefore
 * consumes the kernel's storage directly and only adds optional fluid state.
 */
export type ChunkView = {
  readonly height: KernelChunk['height']
  readonly blocks: Readonly<KernelChunk['blocks']>
  readonly fluid?: FluidView
}

/** An all-air chunk with the requested vertical extent. */
export const emptyChunk = (height: number): ChunkView => {
  const validatedHeight = chunkHeight(height)
  return {
    blocks: chunkBlocks(validatedHeight, new Uint8Array(blocksPerChunk(validatedHeight))),
    height: validatedHeight,
  }
}

const FIRST_LOCAL_INDEX = 0
const LAST_INDEX_OFFSET = 1
const LAST_LOCAL_INDEX = CHUNK_SIZE - LAST_INDEX_OFFSET

/** Read one block, returning air for coordinates outside this chunk. */
export const getBlock = (chunk: ChunkView, lx: number, y: number, lz: number): number => {
  if (
    lx < FIRST_LOCAL_INDEX ||
    lx >= CHUNK_SIZE ||
    y < FIRST_LOCAL_INDEX ||
    y >= chunk.height ||
    lz < FIRST_LOCAL_INDEX ||
    lz >= CHUNK_SIZE
  ) {
    return AIR
  }
  return chunk.blocks.get(y + lz * chunk.height + lx * chunk.height * CHUNK_SIZE) ?? AIR
}

/** Horizontal neighbours used by boundary sampling. */
export type ChunkNeighbours = {
  readonly xPos?: ChunkView
  readonly xNeg?: ChunkView
  readonly zPos?: ChunkView
  readonly zNeg?: ChunkView
  readonly xPosZPos?: ChunkView
  readonly xPosZNeg?: ChunkView
  readonly xNegZPos?: ChunkView
  readonly xNegZNeg?: ChunkView
}

const neighbourBlock = (neighbour: ChunkView | undefined, lx: number, y: number, lz: number): number => {
  if (!neighbour) {
    return AIR
  }
  return getBlock(neighbour, lx, y, lz)
}

const getBlockAtCorner = (neighbours: ChunkNeighbours, lx: number, y: number, lz: number): number | null => {
  if (lx < FIRST_LOCAL_INDEX && lz < FIRST_LOCAL_INDEX) {
    return neighbourBlock(neighbours.xNegZNeg, LAST_LOCAL_INDEX, y, LAST_LOCAL_INDEX)
  }
  if (lx < FIRST_LOCAL_INDEX && lz >= CHUNK_SIZE) {
    return neighbourBlock(neighbours.xNegZPos, LAST_LOCAL_INDEX, y, FIRST_LOCAL_INDEX)
  }
  if (lx >= CHUNK_SIZE && lz < FIRST_LOCAL_INDEX) {
    return neighbourBlock(neighbours.xPosZNeg, FIRST_LOCAL_INDEX, y, LAST_LOCAL_INDEX)
  }
  if (lx >= CHUNK_SIZE && lz >= CHUNK_SIZE) {
    return neighbourBlock(neighbours.xPosZPos, FIRST_LOCAL_INDEX, y, FIRST_LOCAL_INDEX)
  }
  return null
}

const getBlockAtEdge = (neighbours: ChunkNeighbours, lx: number, y: number, lz: number): number | null => {
  if (lx < FIRST_LOCAL_INDEX) {
    return neighbourBlock(neighbours.xNeg, LAST_LOCAL_INDEX, y, lz)
  }
  if (lx >= CHUNK_SIZE) {
    return neighbourBlock(neighbours.xPos, FIRST_LOCAL_INDEX, y, lz)
  }
  if (lz < FIRST_LOCAL_INDEX) {
    return neighbourBlock(neighbours.zNeg, lx, y, LAST_LOCAL_INDEX)
  }
  if (lz >= CHUNK_SIZE) {
    return neighbourBlock(neighbours.zPos, lx, y, FIRST_LOCAL_INDEX)
  }
  return null
}

/** Read a block from this chunk or one of its horizontal neighbours. */
export const getBlockAcrossBoundary = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lx: number,
  y: number,
  lz: number,
): number => {
  const corner = getBlockAtCorner(neighbours, lx, y, lz)
  if (corner !== null) {
    return corner
  }
  const edge = getBlockAtEdge(neighbours, lx, y, lz)
  if (edge !== null) {
    return edge
  }
  return getBlock(chunk, lx, y, lz)
}
