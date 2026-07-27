/**
 * Chunk data -> per-layer face lists, merged.
 *
 * ---------------------------------------------------------------------------
 * This is the greedy merge. It replaced the naive extraction; the naive one is
 * still here, on purpose, and it is not dead code
 * ---------------------------------------------------------------------------
 *
 * `meshChunk` emits one quad per MAXIMAL RECTANGLE of coplanar, like-for-like
 * faces. `meshChunkNaive` emits one quad per exposed block face, as this file
 * did before the merge landed, and it is retained and exported because it is the
 * ORACLE: `meshChunk` is correct exactly when it covers the same surface as
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
 * What may be merged, and why `blockId` alone is the whole key
 * ---------------------------------------------------------------------------
 *
 * Two faces merge when they are in the same direction, on the same depth slice,
 * and carry the same `blockId`. That looks too weak — the invariants say merging
 * must never join across layers, across block types, or across faces with
 * different occlusion — so each of the three is worth saying explicitly:
 *
 *  - ACROSS LAYERS cannot happen, because the layer is a function of the block
 *    id alone (`layerOfBlockId`). Equal ids are in equal layers, always.
 *  - ACROSS BLOCK TYPES cannot happen, because the id IS the key.
 *  - ACROSS DIFFERENT OCCLUSION cannot happen, because occlusion is decided
 *    BEFORE the mask is written: a face that is hidden is never entered into the
 *    mask, and the mask's zero cell is `AIR`, which the expansion refuses to
 *    grow through. Merging therefore cannot reach across a hidden face — there
 *    is nothing there to reach.
 *
 * `role` is a function of `direction` and each direction is meshed in its own
 * pass, so it needs no place in the key either. The reference packs ambient
 * occlusion and four corner lights alongside the id
 * (`greedy-meshing-passes.ts:24-45`) because it merges lit quads; this
 * repository has no lighting yet (docs/responsibility.md §3 lists the light grid
 * as mc-worldgen's and unread here), so the id is the whole of it. When lighting
 * arrives THIS is the comment to come back to: the key has to grow, or slabs
 * with different light will merge and the lighting will visibly flatten.
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
 * plan.md §3.3 specifies `mesh(chunk, neighbors, config) -> {opaque, water,
 * transparentSolid}`, and that is exactly what `meshChunk` returns. The
 * reference reaches the same three buckets by a different route: its
 * `greedyMeshChunk` returns `GreedyMeshResult` with `opaqueRaw` / `waterRaw` /
 * `transparentSolidRaw` as zero-copy subarray VIEWS into a shared accumulator,
 * plus a lazy `toMeshed()` that slices owned copies
 * (`greedy-meshing-types.ts:70-80`). Those views are invalidated by the next
 * call, which is a real hazard and the reason the reference has a comment about
 * it. This repository returns owned data and will add the pooled, view-based
 * fast path behind an explicit opt-in once there is a benchmark to justify it.
 * See docs/design-notes.md, regression `meshing-result-is-owned-not-aliased`.
 */
import {
  AIR,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  getBlock,
  getBlockAcrossBoundary,
  type ChunkNeighbours,
  type ChunkView,
} from './chunk-view'
import { FACES, type Face, type FaceDirection, type FaceRole } from './faces'
import { buildLayerLookup, MESH_LAYERS, type MeshConfig, type MeshLayer } from './opacity'

/**
 * One emitted quad. Positions are chunk-local; mc-render applies the offset.
 *
 * `lx`/`y`/`lz` are the quad's ORIGIN — its minimum corner on every axis — and
 * `width`/`height` are its extents along the two axes `tangentAxes(direction)`
 * names, in that order. For a merged quad the origin is the first cell the
 * expansion claimed, which is the minimum corner because the expansion only ever
 * grows in the positive direction on both axes.
 */
export type Quad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  /** Extent along the face's first tangent axis. At least 1; larger when merged. */
  readonly width: number
  /** Extent along the face's second tangent axis. At least 1; larger when merged. */
  readonly height: number
}

export type MeshLayers = {
  readonly [K in MeshLayer]: ReadonlyArray<Quad>
}

/**
 * Total quads across all layers. What greedy merging REDUCES, and therefore the
 * one number in this file that is not an invariant.
 */
export const totalQuadCount = (layers: MeshLayers): number =>
  layers.opaque.length + layers.water.length + layers.transparentSolid.length

/**
 * Total block-face area covered, summed over every quad in every layer.
 *
 * THE INVARIANT MERGING MUST NOT MOVE, and the reason this function exists at
 * all. `totalQuadCount` was the quantity the face-count tests asserted on while
 * every quad was 1x1, and for 1x1 quads the two are equal — which is exactly why
 * the distinction was invisible and had to be drawn the moment merging landed. A
 * merge that loses a cell, or claims one twice, changes this; a merge that is
 * correct cannot, however many quads it removes.
 */
export const totalQuadArea = (layers: MeshLayers): number => {
  let area = 0
  for (const layer of MESH_LAYERS) {
    for (const quad of layers[layer]) {
      area += quad.width * quad.height
    }
  }
  return area
}

/** Index into `MESH_LAYERS`, i.e. the value `buildLayerLookup` stores. */
const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')

/**
 * The layer a block id belongs to, read from the flattened table.
 *
 * Defaults to `opaque` for an id outside the table, which cannot happen — ids
 * come out of a `Uint8Array` and the table has `MAX_BLOCK_ID + 1` entries — but
 * `noUncheckedIndexedAccess` requires an answer and `opaque` is the one that
 * fails closed: an unknown id occludes rather than opening a hole in the world.
 */
const layerAt = (lookup: Uint8Array, blockId: number): number => lookup[blockId] ?? OPAQUE_LAYER

/**
 * Is the face of `blockId` pointing at `neighbourId` visible?
 *
 * Shared by both meshers, and the single statement of the rule. Two clauses,
 * and they are not the same clause:
 *
 *  1. an OPAQUE neighbour hides the face. Air, water and transparent solids do
 *     not, which is what makes the underside of a lake and the far pane of a
 *     glass box render at all.
 *  2. a neighbour in the SAME layer hides it too: two adjacent water cells have
 *     no surface between them, and neither do two panes of glass. Without this
 *     the inside of a lake is a solid wall of quads, which is both wrong and
 *     ruinously expensive.
 *
 * Reads the flattened table rather than `layerOfBlockId`, which would hit the
 * injected `Set`s. Same answer, and this runs once per cell per face — the
 * ~400k/chunk path plan.md §3.3 measures. The bench guard
 * `set-membership/native-set-vs-lookup-table` prices the difference at 6.5x.
 */
const isFaceExposed = (lookup: Uint8Array, blockId: number, neighbourId: number): boolean => {
  if (neighbourId === AIR) {
    return true
  }
  const neighbourLayer = layerAt(lookup, neighbourId)
  return neighbourLayer !== OPAQUE_LAYER && neighbourLayer !== layerAt(lookup, blockId)
}

/**
 * One past the highest non-air block, i.e. an exclusive upper bound on the Y
 * scan. `0` for an all-air chunk.
 *
 * The reference's `yLimit` (`greedy-meshing.ts:94-101`). No face can exist above
 * the highest solid block — air against air emits nothing — so the six passes
 * skip the empty column above it. On this repository's bench fixtures the
 * terrain tops out around y=64 of 256, so this is most of the scan.
 *
 * Walks each column DOWNWARD from the top and stops as soon as it can: a column
 * is 256 contiguous bytes under `blockIndex`, so this reads whole cache lines,
 * and once one column has found a high block the rest only scan above it. The
 * obvious alternative — one linear pass over all 65,536 bytes tracking the
 * maximum — is contiguous too but never early-exits, and reads the whole chunk
 * even for terrain whose surface is in the first column it looks at.
 */
const solidCeiling = (blocks: Readonly<Uint8Array>): number => {
  let highest = -1
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const columnBase = lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE
      for (let y = CHUNK_HEIGHT - 1; y > highest; y -= 1) {
        if ((blocks[columnBase + y] ?? AIR) !== AIR) {
          highest = y
          break
        }
      }
    }
  }
  return highest + 1
}

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
  blockId: number,
  depth: number,
) => void

/** Do `length` cells starting at `start` all hold `blockId`? */
const rowMatches = (mask: Uint8Array, start: number, length: number, blockId: number): boolean => {
  for (let offset = 0; offset < length; offset += 1) {
    if (mask[start + offset] !== blockId) {
      return false
    }
  }
  return true
}

/**
 * The 2-D greedy merge over one built mask. The heart of this file.
 *
 * The mask is `outerSize * innerSize` block ids, `AIR` meaning "no face here",
 * laid out inner-contiguous. For each cell not yet consumed: extend along the
 * INNER axis while the id repeats, then extend along the OUTER axis while every
 * one of those inner cells repeats on the next row, then clear the rectangle so
 * no later cell claims it again and emit it once.
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
 * ported with the AO/light packing removed.
 */
const expandGreedy = (
  mask: Uint8Array,
  outerSize: number,
  innerSize: number,
  emit: EmitQuad,
  depth: number,
): void => {
  for (let outer = 0; outer < outerSize; outer += 1) {
    for (let inner = 0; inner < innerSize; inner += 1) {
      const base = outer * innerSize + inner
      const blockId = mask[base] ?? AIR
      if (blockId === AIR) {
        continue
      }

      let innerRun = 1
      while (inner + innerRun < innerSize && mask[base + innerRun] === blockId) {
        innerRun += 1
      }

      let outerRun = 1
      while (
        outer + outerRun < outerSize &&
        rowMatches(mask, (outer + outerRun) * innerSize + inner, innerRun, blockId)
      ) {
        outerRun += 1
      }

      for (let row = 0; row < outerRun; row += 1) {
        const rowStart = (outer + row) * innerSize + inner
        mask.fill(AIR, rowStart, rowStart + innerRun)
      }

      emit(outer, inner, outerRun, innerRun, blockId, depth)
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
const meshXPass = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint8Array,
  push: (quad: Quad) => void,
): void => {
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, blockId, depth) => {
    push({
      blockId,
      direction: face.direction,
      role: face.role,
      lx: depth,
      y: inner,
      lz: outer,
      width: innerRun,
      height: outerRun,
    })
  }

  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    mask.fill(AIR, 0, CHUNK_SIZE * yLimit)
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const rowBase = lz * yLimit
      for (let y = 0; y < yLimit; y += 1) {
        const blockId = getBlock(chunk.blocks, lx, y, lz)
        if (blockId === AIR) {
          continue
        }
        if (isFaceExposed(lookup, blockId, getBlockAcrossBoundary(chunk, neighbours, lx + face.nx, y, lz))) {
          mask[rowBase + y] = blockId
        }
      }
    }
    expandGreedy(mask, CHUNK_SIZE, yLimit, emit, lx)
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
const meshYPass = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint8Array,
  push: (quad: Quad) => void,
): void => {
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, blockId, depth) => {
    push({
      blockId,
      direction: face.direction,
      role: face.role,
      lx: outer,
      y: depth,
      lz: inner,
      width: outerRun,
      height: innerRun,
    })
  }

  for (let y = 0; y < yLimit; y += 1) {
    mask.fill(AIR, 0, CHUNK_SIZE * CHUNK_SIZE)
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      const rowBase = lx * CHUNK_SIZE
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const blockId = getBlock(chunk.blocks, lx, y, lz)
        if (blockId === AIR) {
          continue
        }
        if (isFaceExposed(lookup, blockId, getBlockAcrossBoundary(chunk, neighbours, lx, y + face.ny, lz))) {
          mask[rowBase + lz] = blockId
        }
      }
    }
    expandGreedy(mask, CHUNK_SIZE, CHUNK_SIZE, emit, y)
  }
}

/**
 * The +Z / -Z passes. Slice on `lz`; mask is (`lx` outer, `y` inner).
 *
 * `tangentAxes('zPos')` is `['x', 'y']`: `width` along X (outer), `height`
 * along Y (inner).
 */
const meshZPass = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint8Array,
  push: (quad: Quad) => void,
): void => {
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, blockId, depth) => {
    push({
      blockId,
      direction: face.direction,
      role: face.role,
      lx: outer,
      y: inner,
      lz: depth,
      width: outerRun,
      height: innerRun,
    })
  }

  for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
    mask.fill(AIR, 0, CHUNK_SIZE * yLimit)
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      const rowBase = lx * yLimit
      for (let y = 0; y < yLimit; y += 1) {
        const blockId = getBlock(chunk.blocks, lx, y, lz)
        if (blockId === AIR) {
          continue
        }
        if (isFaceExposed(lookup, blockId, getBlockAcrossBoundary(chunk, neighbours, lx, y, lz + face.nz))) {
          mask[rowBase + y] = blockId
        }
      }
    }
    expandGreedy(mask, CHUNK_SIZE, yLimit, emit, lz)
  }
}

/** The three per-layer sinks, and the routing rule, in one place. */
const makeSink = (
  lookup: Uint8Array,
): {
  readonly layers: MeshLayers
  readonly push: (quad: Quad) => void
} => {
  const opaque: Array<Quad> = []
  const water: Array<Quad> = []
  const transparentSolid: Array<Quad> = []
  const buckets = [opaque, water, transparentSolid]
  return {
    layers: { opaque, water, transparentSolid },
    // MESH_LAYERS is ['opaque', 'water', 'transparentSolid'] and the lookup
    // stores an index into it, so the routing is the index — no re-spelling of
    // the priority order, which lives in `opacity.ts` and is tested there.
    push: (quad: Quad): void => {
      const bucket = buckets[layerAt(lookup, quad.blockId)] ?? opaque
      bucket.push(quad)
    },
  }
}

/**
 * Mesh one chunk, merging coplanar like-for-like faces into maximal rectangles.
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
  config: MeshConfig,
): MeshLayers => {
  const lookup = buildLayerLookup(config)
  const { layers, push } = makeSink(lookup)
  const yLimit = solidCeiling(chunk.blocks)
  if (yLimit === 0) {
    return layers
  }

  // One scratch mask, sized for the largest of the three shapes and reused by
  // every slice of every pass. Allocating per slice would be 576 typed arrays
  // per chunk; `expandGreedy` consumes what it reads, and each pass refills the
  // region it is about to use, so sharing is safe.
  const mask = new Uint8Array(CHUNK_SIZE * Math.max(yLimit, CHUNK_SIZE))

  for (const face of FACES) {
    if (face.nx !== 0) {
      meshXPass(chunk, neighbours, lookup, face, yLimit, mask, push)
    } else if (face.ny !== 0) {
      meshYPass(chunk, neighbours, lookup, face, yLimit, mask, push)
    } else {
      meshZPass(chunk, neighbours, lookup, face, yLimit, mask, push)
    }
  }

  return layers
}

/**
 * One quad per exposed block face, with no merging at all. THE ORACLE.
 *
 * This is what `meshChunk` was before the greedy merge landed, kept verbatim
 * apart from sharing `isFaceExposed`. It is exported rather than left in the
 * test file so that there is exactly one naive mesher and it lives next to the
 * merged one: a copy in `test/` would be free to drift, and an oracle that
 * drifts silently stops being one.
 *
 * It is NOT deprecated and it is not a fallback — mc-render should never call
 * it, because it produces the same surface far more expensively. Its callers are
 * the property tests and anyone debugging a suspected merge fault, for whom
 * "what should this have been?" is the whole question.
 *
 * Emits in `lx` then `lz` then `y` within each direction, which is the order
 * this repository declared load-bearing before merging made it impossible to
 * keep for four of the six directions.
 */
export const meshChunkNaive = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
): MeshLayers => {
  const lookup = buildLayerLookup(config)
  const { layers, push } = makeSink(lookup)

  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          const blockId = getBlock(chunk.blocks, lx, y, lz)
          if (blockId === AIR) {
            continue
          }
          const neighbourId = getBlockAcrossBoundary(
            chunk,
            neighbours,
            lx + face.nx,
            y + face.ny,
            lz + face.nz,
          )
          if (!isFaceExposed(lookup, blockId, neighbourId)) {
            continue
          }
          push({
            blockId,
            direction: face.direction,
            role: face.role,
            lx,
            y,
            lz,
            width: 1,
            height: 1,
          })
        }
      }
    }
  }

  return layers
}
