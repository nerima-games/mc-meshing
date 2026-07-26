/**
 * The chunk as meshing sees it, and the hot-path block read.
 *
 * FIRST CUT (叩き台). `ChunkView` is a local structural type: mc-kernel owns the
 * real `Chunk` (plan.md §3.1) but nothing is published yet, so meshing declares
 * the minimum shape it needs. Replacing this with kernel's `Chunk` is a
 * one-line change once mc-kernel ships — see docs/porting.md.
 */

/** Horizontal extent of a chunk, in blocks. */
export const CHUNK_SIZE = 16

/** Vertical extent of a chunk, in blocks. */
export const CHUNK_HEIGHT = 256

/** The block id that means "nothing here". */
export const AIR = 0

/**
 * Block storage layout: `y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE`.
 *
 * Y-major within a column, because meshing and lighting both walk columns
 * top-down and this makes that walk contiguous. Same layout as the reference
 * (`greedy-meshing-ao.ts:8`), which matters: it is what lets the reference's
 * chunk fixtures be reused directly as golden inputs.
 */
export const blockIndex = (lx: number, y: number, lz: number): number =>
  y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE

export type ChunkView = {
  /** `CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE` block ids, laid out per `blockIndex`. */
  readonly blocks: Readonly<Uint8Array>
}

export const BLOCKS_PER_CHUNK = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE

/** An all-air chunk. Useful as a neighbour for an edge chunk, and in tests. */
export const emptyChunk = (): ChunkView => ({ blocks: new Uint8Array(BLOCKS_PER_CHUNK) })

/**
 * ---------------------------------------------------------------------------
 * HOT PATH. Bounds checks are INLINED and there is no `Option`. (plan.md §5.2)
 * ---------------------------------------------------------------------------
 *
 * Read one block, returning `AIR` for anything outside the chunk.
 *
 * Three deliberate choices, all of them performance exceptions carried over
 * from the reference (`greedy-meshing-ao.ts:6-9`):
 *
 *  1. The six bounds comparisons are written out inline as one short-circuiting
 *     `if`, not delegated to a helper. At ~400k calls per chunk the call
 *     overhead is not noise.
 *  2. The return type is `number`, not `Option<number>`. An `Option` allocates
 *     a `Some` per in-bounds read — hundreds of thousands of short-lived
 *     objects per chunk, which is a GC pause you can see in a frame graph.
 *  3. Out of bounds returns the `AIR` sentinel rather than failing. That is the
 *     semantically correct answer, not a fallback: a chunk boundary with no
 *     neighbour loaded should mesh as though open, so the player sees terrain
 *     rather than a black wall while the neighbour streams in.
 *
 * Do not "improve" any of the three. See docs/design-notes.md, regression
 * `meshing-get-block-is-allocation-free`.
 */
export const getBlock = (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number): number => {
  if (lx < 0 || lx >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || lz < 0 || lz >= CHUNK_SIZE) {
    return AIR
  }
  return blocks[y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE] ?? AIR
}

/**
 * The six neighbouring chunks, for boundary faces.
 *
 * All optional: an unloaded neighbour is `undefined` and reads as air, which is
 * the same "mesh as open" rule `getBlock` applies inside a chunk. `yPos`/`yNeg`
 * are present for symmetry but are always `undefined` today, because chunks are
 * full-height columns and therefore have no vertical neighbour.
 */
export type ChunkNeighbours = {
  readonly xPos?: ChunkView
  readonly xNeg?: ChunkView
  readonly zPos?: ChunkView
  readonly zNeg?: ChunkView
}

/**
 * Read a block that may lie one cell outside the chunk, consulting the
 * appropriate neighbour.
 *
 * Only ever called on the 1-cell shell around the chunk, which is
 * 2 * (16 * 256) * 2 cells rather than 16 * 256 * 16, so it is not on the same
 * hot path as `getBlock` and can afford the branch.
 */
export const getBlockAcrossBoundary = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lx: number,
  y: number,
  lz: number,
): number => {
  if (y < 0 || y >= CHUNK_HEIGHT) {
    return AIR
  }
  if (lx < 0) {
    return neighbours.xNeg === undefined ? AIR : getBlock(neighbours.xNeg.blocks, CHUNK_SIZE - 1, y, lz)
  }
  if (lx >= CHUNK_SIZE) {
    return neighbours.xPos === undefined ? AIR : getBlock(neighbours.xPos.blocks, 0, y, lz)
  }
  if (lz < 0) {
    return neighbours.zNeg === undefined ? AIR : getBlock(neighbours.zNeg.blocks, lx, y, CHUNK_SIZE - 1)
  }
  if (lz >= CHUNK_SIZE) {
    return neighbours.zPos === undefined ? AIR : getBlock(neighbours.zPos.blocks, lx, y, 0)
  }
  return getBlock(chunk.blocks, lx, y, lz)
}
