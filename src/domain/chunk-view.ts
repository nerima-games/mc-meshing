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

/**
 * The fluid simulation's per-cell state, as meshing needs to see it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS TWO PLAIN ARRAYS AND NOT THE REFERENCE'S PACKED BYTE
 * ---------------------------------------------------------------------------
 *
 * The reference passes meshing a single `fluid: Uint8Array` and decodes each
 * byte with five masks — present `0x80`, kind `0x10`, source `0x08`, level
 * `0x07` (`packages/block/domain/fluid.ts:9-12`). Those masks belong to the
 * fluid SIMULATION. Restating them here would put a second copy of another
 * repository's encoding in this one, which is the mistake docs/responsibility.md
 * §3.3 refused for coordinates, §3.4 for LOD distances and M-11 for rail shapes:
 * two spellings of one fact, and only one of them is the one anybody updates.
 *
 * So the seam is drawn at the DECODED state instead. The two facts meshing
 * actually needs are how full a cell is and whether it is a source, and they
 * arrive as arrays of numbers with no layout to agree on. Whoever owns the byte
 * decodes it; nothing here has an opinion about how it was stored.
 *
 * The other three fields of that byte are not here, and each is absent for a
 * reason rather than by omission:
 *
 *  - PRESENT is redundant. A cell holds fluid exactly when its block id is one
 *    the caller declared in `MeshConfig.fluidMaxLevels`, so `blocks` already
 *    answers it and a second answer could only ever disagree with the first.
 *    The reference carries both and has to reconcile them
 *    (`greedy-meshing-fluid-state.ts:63`, which discards the cell when the byte
 *    and the block id name different fluids).
 *  - KIND is redundant for the same reason: the block id is the kind.
 *  - MAX LEVEL is not per cell. It is per fluid — 7 for water, 3 for lava
 *    (`fluid-model.ts:15-16`) — and it describes how far the fluid SPREADS,
 *    which is propagation vocabulary. It is injected through `MeshConfig`.
 *
 * BOTH ARRAYS ARE OPTIONAL IN EFFECT: `domain/fluid-mesh.ts` reads a missing
 * `FluidView` as all zeroes, which is a full, non-source cell. A caller that has
 * block ids but no simulation state yet therefore gets flat full-height fluid
 * rather than invisible fluid.
 *
 * LIKE `ChunkView` ITSELF, THIS IS A PLACEHOLDER. docs/responsibility.md §3.6
 * left the fluid input undecided between "wait for the owner to publish" and
 * "declare the minimum structural type here, as `ChunkView` already does for
 * `Chunk`". This is the second, and it is recorded in docs/porting.md as a
 * pending replacement exactly as `ChunkView` is.
 */
export type FluidView = {
  /**
   * Fill level per cell, laid out per `blockIndex`. `0` is fullest; the maximum
   * meaningful value is the fluid's injected `maxLevel`.
   */
  readonly levels: Readonly<Uint8Array>
  /** Non-zero where the cell is a fluid SOURCE rather than flow. Same layout. */
  readonly sources: Readonly<Uint8Array>
}

export type ChunkView = {
  /** `CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE` block ids, laid out per `blockIndex`. */
  readonly blocks: Readonly<Uint8Array>
  /**
   * Per-cell fluid state, when the caller has any.
   *
   * OPTIONAL, so that every `ChunkView` written before fluids existed still
   * typechecks and behaves exactly as it did. It sits on `ChunkView` rather than
   * beside it as a separate parameter so that `ChunkNeighbours` carries it for
   * free — a lake spanning a chunk seam needs the neighbour's levels to compute
   * the corner heights along that seam, and a fluid passed separately would have
   * reached the four neighbours only through a second, parallel structure.
   */
  readonly fluid?: FluidView
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
 * The horizontal neighbouring chunks needed by boundary sampling.
 *
 * All optional: an unloaded neighbour is `undefined` and reads as air, which is
 * the same "mesh as open" rule `getBlock` applies inside a chunk. The diagonal
 * entries are needed only by corner samples such as AO and fluid heights; face
 * visibility still consults the four direct neighbours.
 */
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
  if (lx < 0 && lz < 0) {
    return neighbours.xNegZNeg === undefined
      ? AIR
      : getBlock(neighbours.xNegZNeg.blocks, CHUNK_SIZE - 1, y, CHUNK_SIZE - 1)
  }
  if (lx < 0 && lz >= CHUNK_SIZE) {
    return neighbours.xNegZPos === undefined ? AIR : getBlock(neighbours.xNegZPos.blocks, CHUNK_SIZE - 1, y, 0)
  }
  if (lx >= CHUNK_SIZE && lz < 0) {
    return neighbours.xPosZNeg === undefined ? AIR : getBlock(neighbours.xPosZNeg.blocks, 0, y, CHUNK_SIZE - 1)
  }
  if (lx >= CHUNK_SIZE && lz >= CHUNK_SIZE) {
    return neighbours.xPosZPos === undefined ? AIR : getBlock(neighbours.xPosZPos.blocks, 0, y, 0)
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
