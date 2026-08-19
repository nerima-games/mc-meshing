/**
 * The chunk as meshing sees it, and the hot-path block read.
 *
 * `ChunkView` is the renderer-facing variable-height view. mc-kernel owns the
 * source `Chunk`; use `chunkViewOf` from `kernel-adapter.ts` at that boundary.
 */
import { AIR, type BlockId } from './block-data.js'
import type { LightView } from './light-types.js'
import { MAX_CHUNK_HEIGHT } from '@nerima-games/mc-kernel'
import type { RailShapeView } from './rail-types.js'

/** Horizontal extent of a chunk, in blocks. */
export const CHUNK_SIZE = 16

/** Canonical vertical extent used by the fixtures and the default chunk. */
export const CHUNK_HEIGHT = 256
const MIN_CHUNK_HEIGHT = 1

/**
 * Number of block cells in a chunk with the supplied vertical extent.
 *
 * The upper bound is the same bound enforced by mc-kernel's `ChunkHeight`.
 * Keeping this check at the meshing boundary prevents a malformed view from
 * producing an incorrectly sized typed array or an out-of-range index.
 */
export const blockCountOf = (height: number): number => {
  if (!Number.isInteger(height) || height < MIN_CHUNK_HEIGHT || height > MAX_CHUNK_HEIGHT) {
    throw new RangeError(`Chunk height must be an integer from 1 to ${MAX_CHUNK_HEIGHT}, received ${height}`)
  }
  return CHUNK_SIZE * height * CHUNK_SIZE
}

/**
 * Block storage layout: `y + lz * height + lx * height * CHUNK_SIZE`.
 *
 * Y-major within a column, because meshing and lighting both walk columns
 * top-down and this makes that walk contiguous. Same layout as the reference
 * (`greedy-meshing-ao.ts:8`), which matters: it is what lets the reference's
 * chunk fixtures be reused directly as golden inputs.
 */
export const blockIndex = (lx: number, y: number, lz: number, height: number): number =>
  y + lz * height + lx * height * CHUNK_SIZE

/**
 * The fluid simulation's per-cell state, as meshing needs to see it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS USES DECODED ARRAYS AND NOT THE REFERENCE'S PACKED BYTE
 * ---------------------------------------------------------------------------
 *
 * The reference passes meshing a single `fluid: Uint8Array` and decodes each
 * byte with masks for presence, kind, source, falling, and level
 * (`packages/block/domain/fluid.ts:9-12`). Those masks belong to the
 * fluid SIMULATION. Restating them here would put a second copy of another
 * repository's encoding in this one, which is the mistake docs/responsibility.md
 * §3.3 refused for coordinates and §3.4 for LOD distances: two spellings of one
 * fact, and only one of them is the one anybody updates. Rail state follows the
 * same boundary: `railShapes` carries decoded renderer-facing values, while the
 * source's state storage and codec remain outside this package.
 *
 * So the seam is drawn at the DECODED state instead. Meshing needs to know how
 * full a cell is, whether it is a source, and optionally whether it is falling;
 * those facts arrive as arrays of numbers with no byte layout to agree on.
 * Whoever owns the byte decodes it; nothing here has an opinion about storage.
 *
 * The remaining encoded fields are not duplicated here, and each is absent for a
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
 * The state is optional at the `ChunkView` boundary because mc-kernel 0.4.0
 * publishes no fluid sidecar. When present, `FluidView` is complete decoded
 * renderer state: all three arrays are required. A missing `FluidView` is
 * interpreted by fluid sampling as a full, non-source cell so block ids still
 * produce visible fluid geometry before simulation state is available.
 *
 * The type intentionally stops at decoded state. The owner of simulation
 * storage decodes its packed bytes before passing this view; meshing does not
 * duplicate that codec.
 */
export type FluidView = {
  /**
   * Fill level per cell, laid out per `blockIndex`. `0` is fullest; the maximum
   * meaningful value is the fluid's injected `maxLevel`.
   */
  readonly levels: Readonly<Uint8Array>
  /** Non-zero where the cell is a fluid SOURCE rather than flow. Same layout. */
  readonly sources: Readonly<Uint8Array>
  /**
   * Non-zero where the fluid is falling vertically. Same layout.
   */
  readonly falling: Readonly<Uint8Array>
}

export type ChunkView = {
  /** Vertical extent of this chunk, in blocks. */
  readonly height: number
  /** `CHUNK_SIZE * height * CHUNK_SIZE` block ids, laid out per `blockIndex`. */
  readonly blocks: Readonly<Uint8Array>
  /**
   * Per-cell decoded fluid state when available from the simulation boundary.
   *
   * It remains optional because mc-kernel 0.4.0 owns block ids only and does not
   * publish a fluid sidecar. When present, all `FluidView` arrays are required.
   * It sits on `ChunkView` rather than beside it as a separate parameter so that
   * `ChunkNeighbours` carries it for free — a lake spanning a chunk seam needs
   * the neighbour's levels to compute corner heights along that seam, and a
   * fluid passed separately would have reached the four neighbours only through
   * a second, parallel structure.
   */
  readonly fluid?: FluidView
  /** Decoded vanilla rail shape per cell; absent when the source has no state sidecar. */
  readonly railShapes?: RailShapeView
  readonly light?: LightView
}

export const BLOCKS_PER_CHUNK = blockCountOf(CHUNK_HEIGHT)

/** An all-air chunk. Useful as a neighbour for an edge chunk, and in tests. */
export const emptyChunk = (height = CHUNK_HEIGHT): ChunkView => ({ blocks: new Uint8Array(blockCountOf(height)), height })

/** First valid index along any chunk-local axis (`lx`, `y`, or `lz`). */
const FIRST_LOCAL_INDEX = 0

/** `CHUNK_SIZE` is a count, so the last valid index is one less than it. */
const LAST_INDEX_OFFSET = 1

/** Last valid index along a horizontal chunk-local axis (`lx` or `lz`). */
const LAST_LOCAL_INDEX = CHUNK_SIZE - LAST_INDEX_OFFSET

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
 *  2. The return type is `BlockId`, not `Option<BlockId>`. An `Option` allocates
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
export const getBlock = (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number, height: number): BlockId => {
  if (
    lx < FIRST_LOCAL_INDEX ||
    lx >= CHUNK_SIZE ||
    y < FIRST_LOCAL_INDEX ||
    y >= height ||
    lz < FIRST_LOCAL_INDEX ||
    lz >= CHUNK_SIZE
  ) {
    return AIR
  }
  return (blocks[y + lz * height + lx * height * CHUNK_SIZE] ?? AIR) as BlockId
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
/**
 * Read one block from a specific optional neighbour, or `AIR` when that
 * neighbour is not loaded.
 *
 * Every branch of `getBlockAcrossBoundary` reduces to this same shape —
 * "is there a chunk here, and if so what is at this local coordinate in it"
 * — so it is factored out once rather than repeated per neighbour.
 */
const neighbourBlock = (neighbour: ChunkView | undefined, lx: number, y: number, lz: number): BlockId => {
  if (neighbour) {
    return getBlock(neighbour.blocks, lx, y, lz, neighbour.height)
  }
  return AIR
}

/**
 * Resolve a coordinate that has crossed BOTH horizontal boundaries at once —
 * one of the four diagonal neighbours.
 *
 * Returns `null`, not a `MeshLayer`-style sentinel, when `lx`/`lz` are not
 * both out of range, so `getBlockAcrossBoundary` falls through to the
 * single-axis cases. `null` rather than `undefined` because this file's
 * `no-undefined` rule bans the latter identifier; the two are otherwise
 * interchangeable here.
 */
const getBlockAtCorner = (neighbours: ChunkNeighbours, lx: number, y: number, lz: number): BlockId | null => {
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

/**
 * Resolve a coordinate that has crossed exactly ONE horizontal boundary —
 * one of the four direct (non-diagonal) neighbours.
 *
 * Returns `null` when `lx`/`lz` are both in range, so `getBlockAcrossBoundary`
 * falls through to reading the chunk itself. Only reached after
 * `getBlockAtCorner` has already ruled out both axes being out of range at
 * once, so at most one of the four checks below can match.
 */
const getBlockAtEdge = (neighbours: ChunkNeighbours, lx: number, y: number, lz: number): BlockId | null => {
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

export const getBlockAcrossBoundary = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lx: number,
  y: number,
  lz: number,
): BlockId => {
  if (y < FIRST_LOCAL_INDEX || y >= chunk.height) {
    return AIR
  }
  const corner = getBlockAtCorner(neighbours, lx, y, lz)
  if (corner !== null) {
    return corner
  }
  const edge = getBlockAtEdge(neighbours, lx, y, lz)
  if (edge !== null) {
    return edge
  }
  return getBlock(chunk.blocks, lx, y, lz, chunk.height)
}
