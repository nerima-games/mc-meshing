/**
 * Chunk data -> per-layer face lists, merged.
 *
 * ---------------------------------------------------------------------------
 * This is the greedy merge. The naive oracle and region remesher live in
 * neighboring modules and are re-exported below.
 * ---------------------------------------------------------------------------
 *
 * `meshChunk` emits one quad per MAXIMAL RECTANGLE of coplanar, like-for-like
 * opaque faces. Transparent cube faces stay unit-sized so sorting and future
 * per-cell attributes remain conservative. `meshChunkNaive` emits one quad per
 * exposed block face, as the pre-merge implementation did, and it is retained
 * and exported because it is the ORACLE: `meshChunk` is correct exactly when
 * it covers the same surface as
 * `meshChunkNaive` with fewer quads, and that is a property a test can state
 * (`test/mesh.test.ts`, `merged output covers exactly the same surface as the
 * naive output`). Deleting it would leave the merge checked only against
 * hand-counted fixtures, which is how a merge that is subtly wrong on terrain
 * nobody wrote a fixture for gets shipped.
 *
 * The two share `isFaceExposed` deliberately. What the property is for is MERGE
 * bugs — a dropped cell, a doubly-covered cell, a width written where a height
 * belongs — and those are the failure modes the merge introduces. Which faces
 * are visible in the first place is a separate question, already pinned by the
 * occlusion and boundary tests, and giving the two meshers two spellings of it
 * would only mean the property fails for reasons that are not about merging.
 *
 * ---------------------------------------------------------------------------
 * What may be merged: opaque `blockId` AND ambient occlusion
 * ---------------------------------------------------------------------------
 *
 * Two opaque faces merge when they are in the same direction, on the same depth slice,
 * and carry the same `blockId` AND the same `ao`. The invariants say merging
 * must never join across layers, across block types, or across faces with
 * different occlusion, so each of the three is worth saying explicitly:
 *
 *  - ACROSS LAYERS cannot happen, because the layer is a function of the block
 *    id alone (`layerOfBlockId`). Equal ids are in equal layers, always.
 *  - ACROSS BLOCK TYPES cannot happen, because the id IS half the key.
 *  - ACROSS DIFFERENT OCCLUSION cannot happen, because occlusion is decided
 *    BEFORE the mask is written: a face that is hidden is never entered into the
 *    mask, and the mask's zero cell means "no face", which the expansion refuses
 *    to grow through. Merging therefore cannot reach across a hidden face —
 *    there is nothing there to reach.
 *
 * `role` is a function of `direction` and each direction is meshed in its own
 * pass, so it needs no place in the key.
 *
 * AO IS IN THE KEY BECAUSE THE REFERENCE PUTS IT THERE, and because there is no
 * other place it can go. `packMask` writes the block id into bits 0-7 and the
 * quantised AO into bits 8-9 of one 32-bit mask cell
 * (`greedy-meshing-passes.ts:24-45`), and `runGreedyExpansion` grows a rectangle
 * only while the WHOLE cell repeats (:77, :84) — so the reference merges two
 * faces only when their AO agrees, and says so: "greedy expansion only merges
 * quads with identical lighting+ao+blockId — the expected vanilla trade-off"
 * (:20-22). The alternative, applying AO after merging, has nothing to apply:
 * a quad spanning cells of differing AO has no single correct value, so it would
 * have to pick one (a visibly wrong shade over most of its area) or split again,
 * which is this, done later and twice.
 *
 * That works only because the reference's AO is PER FACE rather than per vertex
 * — see `domain/ambient-occlusion.ts`, which is where that distinction and its
 * consequences are argued. AO does not change WHICH faces are exposed, only how
 * they group, so `totalQuadArea` is unmoved and the coverage property below
 * holds exactly as before.
 *
 * The four CORNER LIGHTS the reference packs beside them are not here: this
 * repository has no lighting yet (docs/responsibility.md §3 lists the light grid
 * as mc-worldgen's and unread here). When lighting arrives THIS is the comment
 * to come back to: the key has to grow again, or slabs with different light will
 * merge and the lighting will visibly flatten.
 *
 * ---------------------------------------------------------------------------
 * THE EMISSION ORDER CHANGED, AND IT HAD TO
 * ---------------------------------------------------------------------------
 *
 * This file used to declare `lx` then `lz` then `y` within a direction, and
 * declare it load-bearing for golden hashes. A greedy merge cannot keep that.
 * Merging is per-slice by construction — you cannot find a maximal rectangle in
 * a plane without visiting that plane's cells together — so the axis normal to
 * the face has to become the OUTERMOST loop, and for the +Y/-Y passes that axis
 * is `y`, which the old order had innermost. The order below is the new one and
 * it is pinned per direction rather than as one rule for all six:
 *
 *   xPos, xNeg    lx (slice) -> lz -> y      unchanged from the naive order
 *   yPos, yNeg    y  (slice) -> lx -> lz
 *   zPos, zNeg    lz (slice) -> lx -> y
 *
 * The canonical DIRECTION order (`FACES`) is untouched, and that is the half of
 * the ordering mc-render's golden hashes were really pinned to. Within a
 * direction the sequence moved, so any hash taken over a full geometry buffer
 * moves with it. That is a mesh-format change, not a refactor; see
 * docs/design-notes.md M-4 and docs/testing.md.
 *
 * The slice axis is chosen for the merge; the choice of which REMAINING axis is
 * outer and which is inner is a cache decision. `blockIndex` is y-major within a
 * column, so `y` is the contiguous axis and is innermost wherever it is not the
 * slice axis. The alternative — inner `lz`, outer `y` for the X passes — reads
 * one byte per 256-byte stride and measurably wastes the line it just pulled in.
 *
 * ---------------------------------------------------------------------------
 * The output shape
 * ---------------------------------------------------------------------------
 *
 * The public result keeps the three cube layers from the original meshing
 * contract and adds dedicated arrays for crosses, fluids, and special renders.
 * The reference reaches the same three cube buckets by a different route: its
 * `greedyMeshChunk` returns `GreedyMeshResult` with `opaqueRaw` / `waterRaw` /
 * `transparentSolidRaw` as zero-copy subarray VIEWS into a shared accumulator,
 * plus a lazy `toMeshed()` that slices owned copies
 * (`greedy-meshing-types.ts:70-80`). Those views are invalidated by the next
 * call, which is a real hazard and the reason the reference has a comment about
 * it. This repository returns owned data and will add the pooled, view-based
 * fast path behind an explicit opt-in once there is a benchmark to justify it.
 * See docs/design-notes.md, regression `meshing-result-is-owned-not-aliased`.
 */
import { BLOCK_ID_MAX, type MeshConfig } from './opacity.js'
import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { FACES, type Face } from './faces.js'
import {
  FIRST_INDEX,
  OPAQUE_LAYER,
  STEP,
  isFaceExposed,
  isPaintableCell,
  layerAt,
  makeSink,
  meshCrossPlants,
  meshFluidSurfaces,
  meshLookupsFor,
  meshSpecialBlocks,
  solidCeiling,
} from './mesh-common.js'
import type { MeshLayers, Quad } from './mesh-types.js'
import { MINECRAFT_MESH_CONFIG } from './kernel-mesh-config.js'
import { ambientOcclusionAt } from './ambient-occlusion.js'

export { totalQuadArea, totalQuadCount } from './mesh-types.js'
export type { MeshLayers, MeshRegion, Quad, RegionMesh } from './mesh-types.js'
export { meshChunkNaive } from './mesh-naive.js'
export { meshChunkRegion } from './mesh-region.js'

/**
 * ---------------------------------------------------------------------------
 * The mask cell: the merge key, packed
 * ---------------------------------------------------------------------------
 *
 * `blockId` in bits 0-7, `ao` in bits 8-9 — the reference's layout for the same
 * two fields (`greedy-meshing-passes.ts:8-11`). Two faces merge exactly when
 * their whole cells are equal, so packing the key into one number is what makes
 * `expandGreedy` a comparison of numbers rather than a comparison of records.
 *
 * `NO_FACE` is 0 and is UNAMBIGUOUS: a cell is only ever written for an exposed
 * face, a face is only ever emitted for a non-air block, and `AIR` is 0 — so a
 * packed cell whose id is 0 cannot occur, whatever its AO. The zero cell
 * therefore means "no face here" and nothing else, and `expandGreedy` can use it
 * as its terminator without a separate presence bit.
 *
 * `Uint16Array` rather than the reference's `Uint32Array`: the reference needs
 * 26 bits because it packs eight corner-light fields beside these two. With only
 * the id and the AO the key is 10 bits, and halving the mask halves the bytes
 * the per-slice `fill` touches.
 */
const AO_SHIFT = 8

/** Empty mask cell. See above for why 0 cannot collide with a real face. */
const NO_FACE = 0

const packFaceCell = (blockId: number, ao: number): number => blockId | (ao << AO_SHIFT)

const faceCellBlockId = (cell: number): number => cell & BLOCK_ID_MAX

const faceCellAo = (cell: number): number => cell >> AO_SHIFT

/**
 * Called once per maximal rectangle found.
 *
 * `depth` is the slice index — the coordinate on the face's normal axis — and is
 * threaded through as a PARAMETER rather than captured. Capturing it would mean
 * a fresh closure per slice, which is up to 576 per chunk (16 + 16 + 256 slices
 * over six passes); the reference makes the same choice and says so
 * (`greedy-meshing-passes.ts:61-63`). It also keeps `no-loop-func` satisfied
 * without an escape hatch, which is a smaller reason pointing the same way.
 */
type EmitQuad = (
  outer: number,
  inner: number,
  outerRun: number,
  innerRun: number,
  cell: number,
  depth: number,
) => void

/** Do `length` cells starting at `start` all hold `cell`? */
const rowMatches = (mask: Uint16Array, start: number, length: number, cell: number): boolean => {
  for (let offset = FIRST_INDEX; offset < length; offset += STEP) {
    if (mask[start + offset] !== cell) {
      return false
    }
  }
  return true
}

/**
 * The 2-D greedy merge over one built mask. The heart of this file.
 *
 * The mask is `outerSize * innerSize` packed cells, `NO_FACE` meaning "no face
 * here", laid out inner-contiguous. For each cell not yet consumed: extend along
 * the INNER axis while the cell repeats, then extend along the OUTER axis while
 * every one of those inner cells repeats on the next row, then clear the
 * rectangle so no later cell claims it again and emit it once.
 *
 * It compares WHOLE CELLS, so everything packed into one is automatically part
 * of the merge key and nothing here has to know what the fields are. That is why
 * adding AO changed the packing and left this function alone, and why adding
 * light later will do the same.
 *
 * Inner-first is what makes the scan cheap: the inner run is a contiguous
 * memory walk, and the outer test only ever examines rows it is about to claim.
 * Growing outer-first would work and would produce a different — equally valid,
 * differently shaped — tiling; it would just read across the stride on every
 * probe. Either way the result is a partition, which is the property that
 * matters: every masked cell ends up in exactly one emitted rectangle, so the
 * covered area is conserved and no cell is covered twice.
 *
 * This is not the MINIMAL number of rectangles — computing that is far more
 * expensive and nobody's mesher does it. It is the standard greedy sweep the
 * reference uses (`runGreedyExpansion`, `greedy-meshing-passes.ts:64-97`),
 * ported with the corner-light packing removed.
 */
/**
 * Grow the inner run starting at `base` as far as contiguous cells keep
 * matching `cell`. Returns the run length, at least 1 for the starting cell.
 */
const growInnerRun = (mask: Uint16Array, base: number, inner: number, innerSize: number, cell: number): number => {
  let innerRun = 1
  while (inner + innerRun < innerSize && mask[base + innerRun] === cell) {
    innerRun += STEP
  }
  return innerRun
}

/**
 * Grow the outer run starting at `outer`, one whole matching row of
 * `innerRun` cells at a time. Returns the run length, at least 1 for the
 * starting row.
 */
const growOuterRun = (
  mask: Uint16Array,
  outer: number,
  inner: number,
  outerSize: number,
  innerSize: number,
  innerRun: number,
  cell: number,
): number => {
  let outerRun = 1
  while (
    outer + outerRun < outerSize &&
    rowMatches(mask, (outer + outerRun) * innerSize + inner, innerRun, cell)
  ) {
    outerRun += STEP
  }
  return outerRun
}

/** Mark every cell of the just-claimed `outerRun` x `innerRun` rectangle as consumed. */
const clearRectangle = (
  mask: Uint16Array,
  outer: number,
  inner: number,
  outerRun: number,
  innerRun: number,
  innerSize: number,
): void => {
  for (let row = FIRST_INDEX; row < outerRun; row += STEP) {
    const rowStart = (outer + row) * innerSize + inner
    mask.fill(NO_FACE, rowStart, rowStart + innerRun)
  }
}

const expandGreedy = (
  mask: Uint16Array,
  outerSize: number,
  innerSize: number,
  emit: EmitQuad,
  depth: number,
): void => {
  for (let outer = FIRST_INDEX; outer < outerSize; outer += STEP) {
    for (let inner = FIRST_INDEX; inner < innerSize; inner += STEP) {
      const base = outer * innerSize + inner
      // ASSERTED: `mask` is always allocated at least `outerSize * innerSize`
      // Entries (see the three `expandGreedy` call sites), and `outer < outerSize`,
      // `inner < innerSize` by the loops above, so `base` is always in range.
      const cell = mask[base]!
      if (cell !== NO_FACE) {
        const innerRun = growInnerRun(mask, base, inner, innerSize, cell)
        const outerRun = growOuterRun(mask, outer, inner, outerSize, innerSize, innerRun, cell)
        clearRectangle(mask, outer, inner, outerRun, innerRun, innerSize)
        emit(outer, inner, outerRun, innerRun, cell, depth)
      }
    }
  }
}

/**
 * Everything a single X/Y/Z pass needs that stays constant across its whole
 * scan, bundled so the per-cell and per-slice helpers below stay within this
 * file's `max-params` budget instead of re-threading eight separate values.
 */
type ColumnPassContext = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly lookup: Uint8Array
  readonly plants: Uint8Array
  readonly fluids: Uint8Array
  readonly specials: Uint8Array
  readonly face: Face
  readonly mask: Uint16Array
  readonly push: (quad: Quad) => void
}

type MeshPassContext = {
  readonly chunk: ChunkView
  readonly fluids: Uint8Array
  readonly lookup: Uint8Array
  readonly mask: Uint16Array
  readonly neighbours: ChunkNeighbours
  readonly plants: Uint8Array
  readonly push: (quad: Quad) => void
  readonly specials: Uint8Array
  readonly yLimit: number
}

const columnPassContextOf = (ctx: MeshPassContext, face: Face): ColumnPassContext => ({
  chunk: ctx.chunk,
  face,
  fluids: ctx.fluids,
  lookup: ctx.lookup,
  mask: ctx.mask,
  neighbours: ctx.neighbours,
  plants: ctx.plants,
  push: ctx.push,
  specials: ctx.specials,
})

/**
 * Resolve exposure and AO for one candidate cell already known to be a
 * paintable (non-air, non-plant, non-fluid) block, and route it: an opaque
 * face is merged into `mask` at `maskIndex` for `expandGreedy` to pick up
 * later, anything else is pushed immediately as a unit quad. Shared by all
 * three axis passes — each computes its own `neighbourId` and `maskIndex`
 * because those two differ per axis.
 */
const resolveExposedCell = (
  ctx: ColumnPassContext,
  blockId: number,
  lx: number,
  y: number,
  lz: number,
  neighbourId: number,
  maskIndex: number,
): void => {
  if (isFaceExposed(ctx.lookup, ctx.plants, ctx.specials, blockId, neighbourId)) {
    const ao = ambientOcclusionAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz)
    if (layerAt(ctx.lookup, blockId) === OPAQUE_LAYER) {
      ctx.mask[maskIndex] = packFaceCell(blockId, ao)
    } else {
      ctx.push({ ao, blockId, direction: ctx.face.direction, height: 1, lx, lz, role: ctx.face.role, width: 1, y })
    }
  }
}

/** Fill `ctx.mask` for one +X/-X slice (`lx` fixed): mask is (`lz` outer, `y` inner). */
const fillXSliceMask = (ctx: ColumnPassContext, lx: number, yLimit: number): void => {
  const { blocks, height } = ctx.chunk
  const xBase = lx * height * CHUNK_SIZE
  ctx.mask.fill(NO_FACE, FIRST_INDEX, CHUNK_SIZE * yLimit)
  for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
    const columnBase = xBase + lz * height
    const rowBase = lz * yLimit
    for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
      const blockId = blocks.get(columnBase + y)
      if (isPaintableCell(ctx, blockId)) {
        resolveExposedCell(
          ctx,
          blockId,
          lx,
          y,
          lz,
          getBlockAcrossBoundary(ctx.chunk, ctx.neighbours, lx + ctx.face.nx, y, lz),
          rowBase + y,
        )
      }
    }
  }
}

/** Fill `ctx.mask` for one +Y/-Y slice (`y` fixed): mask is (`lx` outer, `lz` inner). */
const fillYSliceMask = (ctx: ColumnPassContext, y: number): void => {
  const { blocks, height } = ctx.chunk
  ctx.mask.fill(NO_FACE, FIRST_INDEX, CHUNK_SIZE * CHUNK_SIZE)
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    const columnBase = lx * height * CHUNK_SIZE + y
    const rowBase = lx * CHUNK_SIZE
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const blockId = blocks.get(columnBase + lz * height)
      if (isPaintableCell(ctx, blockId)) {
        resolveExposedCell(
          ctx,
          blockId,
          lx,
          y,
          lz,
          getBlockAcrossBoundary(ctx.chunk, ctx.neighbours, lx, y + ctx.face.ny, lz),
          rowBase + lz,
        )
      }
    }
  }
}

/** Fill `ctx.mask` for one +Z/-Z slice (`lz` fixed): mask is (`lx` outer, `y` inner). */
const fillZSliceMask = (ctx: ColumnPassContext, lz: number, yLimit: number): void => {
  const { blocks, height } = ctx.chunk
  ctx.mask.fill(NO_FACE, FIRST_INDEX, CHUNK_SIZE * yLimit)
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    const columnBase = lz * height + lx * height * CHUNK_SIZE
    const rowBase = lx * yLimit
    for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
      const blockId = blocks.get(columnBase + y)
      if (isPaintableCell(ctx, blockId)) {
        resolveExposedCell(
          ctx,
          blockId,
          lx,
          y,
          lz,
          getBlockAcrossBoundary(ctx.chunk, ctx.neighbours, lx, y, lz + ctx.face.nz),
          rowBase + y,
        )
      }
    }
  }
}

/**
 * The +X / -X passes. Slice on `lx`; mask is (`lz` outer, `y` inner).
 *
 * `tangentAxes('xPos')` is `['y', 'z']`, so `width` runs along Y — the inner
 * axis — and `height` along Z. Getting this pairing backwards produces a mesh
 * with exactly the right quad count covering exactly the wrong rectangles, which
 * no count-based test can see; `domain/faces.ts` says the same thing at greater
 * length and is worth reading before touching any of the three passes.
 */
const meshXPass = (ctx: MeshPassContext, face: Face): void => {
  const columnContext = columnPassContextOf(ctx, face)
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, depth) => {
    ctx.push({
      ao: faceCellAo(cell),
      blockId: faceCellBlockId(cell),
      direction: face.direction,
      height: outerRun,
      lx: depth,
      lz: outer,
      role: face.role,
      width: innerRun,
      y: inner,
    })
  }

  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    fillXSliceMask(columnContext, lx, ctx.yLimit)
    expandGreedy(ctx.mask, CHUNK_SIZE, ctx.yLimit, emit, lx)
  }
}

/**
 * The +Y / -Y passes. Slice on `y`; mask is (`lx` outer, `lz` inner).
 *
 * `tangentAxes('yPos')` is `['x', 'z']`, so `width` runs along X — the outer
 * axis this time — and `height` along Z. The two families really do pair the
 * runs the opposite way round, which is why this is not one parameterised pass.
 *
 * Neither axis of this mask is Y, so neither is contiguous in storage; the
 * inner/outer choice here is arbitrary and follows the reference's.
 */
const meshYPass = (ctx: MeshPassContext, face: Face): void => {
  const columnContext = columnPassContextOf(ctx, face)
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, depth) => {
    ctx.push({
      ao: faceCellAo(cell),
      blockId: faceCellBlockId(cell),
      direction: face.direction,
      height: innerRun,
      lx: outer,
      lz: inner,
      role: face.role,
      width: outerRun,
      y: depth,
    })
  }

  for (let y = FIRST_INDEX; y < ctx.yLimit; y += STEP) {
    fillYSliceMask(columnContext, y)
    expandGreedy(ctx.mask, CHUNK_SIZE, CHUNK_SIZE, emit, y)
  }
}

/**
 * The +Z / -Z passes. Slice on `lz`; mask is (`lx` outer, `y` inner).
 *
 * `tangentAxes('zPos')` is `['x', 'y']`: `width` along X (outer), `height`
 * along Y (inner).
 */
const meshZPass = (ctx: MeshPassContext, face: Face): void => {
  const columnContext = columnPassContextOf(ctx, face)
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, depth) => {
    ctx.push({
      ao: faceCellAo(cell),
      blockId: faceCellBlockId(cell),
      direction: face.direction,
      height: innerRun,
      lx: outer,
      lz: depth,
      role: face.role,
      width: outerRun,
      y: inner,
    })
  }

  for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
    fillZSliceMask(columnContext, lz, ctx.yLimit)
    expandGreedy(ctx.mask, CHUNK_SIZE, ctx.yLimit, emit, lz)
  }
}

/** `solidCeiling`'s return value for a chunk that is entirely air. */
const EMPTY_CHUNK_CEILING = 0

/** A face normal component of this value means "no offset on this axis". */
const NO_OFFSET = 0

/** Route one face to whichever of the three axis passes its normal lies on. */
const meshFace = (ctx: MeshPassContext, face: Face): void => {
  if (face.nx !== NO_OFFSET) {
    meshXPass(ctx, face)
  } else if (face.ny !== NO_OFFSET) {
    meshYPass(ctx, face)
  } else {
    meshZPass(ctx, face)
  }
}

/** Mesh every face direction into `mask`/`push`, for one chunk. */
const meshAllFaces = (ctx: MeshPassContext): void => {
  for (const face of FACES) {
    meshFace(ctx, face)
  }
}

/**
 * Mesh one chunk, merging coplanar like-for-like opaque faces into maximal rectangles.
 *
 * Faces are emitted in the canonical direction order (`FACES`); within a
 * direction, see the emission-order table in this file's header. A face is
 * emitted when the cell is non-air and `isFaceExposed` says the neighbour across
 * that face does not hide it.
 *
 * `let` + `for` throughout, and a plain mutable array per layer. Same exemption
 * as the octave loop in mc-noise: this walks 16 x 16 x yLimit cells six times.
 */
export const meshChunk = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig = MINECRAFT_MESH_CONFIG,
): MeshLayers => {
  const { fluids, lookup, plants, specials } = meshLookupsFor(config)
  const yLimit = solidCeiling(chunk)
  const isVisible = (blockId: number, neighbourId: number): boolean =>
    isFaceExposed(lookup, plants, specials, blockId, neighbourId)
  // Plants and fluid surfaces are meshed BEFORE the sink is built, because the
  // Sink owns the result object and both are part of it. Both are bounded by the
  // Same `yLimit`: a plant and a fluid are non-air blocks, so neither can exist
  // Above the highest one.
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants(chunk, plants, yLimit),
    meshFluidSurfaces({ chunk, fluids, layers: lookup, neighbours, plants, yLimit }),
    meshSpecialBlocks({ chunk, isFaceVisible: isVisible, lookup: specials, neighbours, yLimit }),
  )
  if (yLimit === EMPTY_CHUNK_CEILING) {
    return layers
  }

  // One scratch mask, sized for the largest of the three shapes and reused by
  // Every slice of every pass. Allocating per slice would be 576 typed arrays
  // Per chunk; `expandGreedy` consumes what it reads, and each pass refills the
  // Region it is about to use, so sharing is safe.
  const mask = new Uint16Array(CHUNK_SIZE * Math.max(yLimit, CHUNK_SIZE))
  meshAllFaces({ chunk, fluids, lookup, mask, neighbours, plants, push, specials, yLimit })

  return layers
}
