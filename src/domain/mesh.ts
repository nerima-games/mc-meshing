/**
 * Chunk data -> per-layer face lists, merged.
 *
 * ---------------------------------------------------------------------------
 * This is the greedy merge. It replaced the naive extraction; the naive one is
 * still here, on purpose, and it is not dead code
 * ---------------------------------------------------------------------------
 *
 * `meshChunk` emits one quad per MAXIMAL RECTANGLE of coplanar, like-for-like
 * opaque faces. Transparent cube faces stay unit-sized so sorting and future
 * per-cell attributes remain conservative. `meshChunkNaive` emits one quad per exposed block face, as this file
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
  type ChunkNeighbours,
  type ChunkView,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view'
import {
  type CrossPlantQuad,
  buildCrossPlantLookup,
  isCrossPlant,
  meshCrossPlants,
} from './plant-mesh'
import { FACES, type Face, type FaceDirection, type FaceRole } from './faces'
import {
  type FluidQuad,
  buildFluidLookup,
  isFluidBlock,
  meshFluidSurfaces,
} from './fluid-mesh'
import { MAX_BLOCK_ID, MESH_LAYERS, type MeshConfig, type MeshLayer, buildLayerLookup } from './opacity'
import { ambientOcclusionAt } from './ambient-occlusion'

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
  /**
   * Ambient occlusion for the WHOLE quad, in `[0, AO_MAX]`. Higher is darker.
   *
   * One value, not four, and that is the reference's model rather than a
   * simplification of it — `domain/ambient-occlusion.ts` says why at length. It
   * is uniform over the quad by construction: AO is part of the merge key, so a
   * rectangle is only ever grown across cells that already agreed on it.
   */
  readonly ao: number
}

export type MeshLayers = {
  readonly [K in MeshLayer]: ReadonlyArray<Quad>
} & {
  /**
   * Cross-plate plant geometry: flowers, grass, saplings. NOT block faces.
   *
   * A FOURTH LIST BESIDE THE THREE plan.md §3.3 SPECIFIES, and a deliberate
   * deviation from that API rather than an oversight. A cross plate is a
   * diagonal, fractionally-inset pane: it has no `FaceDirection`, no integer
   * extents, and covers no block face, so it cannot be a `Quad` and cannot go in
   * a `Quad` list. `domain/plant-mesh.ts` argues the alternatives; the short
   * version is that the choice is not "deviate or not" but "deviate here, where
   * it is visible in the type, or inside `Quad`, where it is not".
   *
   * It is NOT part of `totalQuadArea` or `totalQuadCount`. Those measure block
   * faces — the quantity the greedy merge must conserve and reduce respectively
   * — and a cross plate is neither covered by nor mergeable with one. Counting
   * it would make the merge's central invariant read as violated by a flower.
   */
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  /**
   * Fluid surfaces: lake tops and the skirts that close the steps between them.
   * NOT block faces either.
   *
   * A FIFTH LIST, on the same terms and for the same reason as `crossPlants`. A
   * fluid top has four independently fractional corner heights, so it is a
   * bilinear patch rather than a rectangle and no `Quad` can describe it — and
   * the slope between those corners is the geometric feature. Top surfaces also
   * carry a normalized flow descriptor for renderer animation; neither fact can
   * be represented by the integer-extents `Quad`. `domain/fluid-mesh.ts` argues it.
   *
   * EMPTY UNLESS `MeshConfig.fluidMaxLevels` DECLARES SOMETHING. Absent means no
   * id is a fluid, which is what every config written before this list existed
   * meant, and is what keeps their quad counts and baselines untouched.
   *
   * Like `crossPlants` it is outside `totalQuadArea` and `totalQuadCount`: a
   * surface at height 0.875 covers no block face, so counting it would make the
   * merge's conservation invariant read as violated by a puddle.
   */
  readonly fluids: ReadonlyArray<FluidQuad>
}

/** Chunk-local, half-open integer bounds: min is inclusive and max is exclusive. */
export type MeshRegion = {
  readonly min: readonly [lx: number, y: number, lz: number]
  readonly max: readonly [lx: number, y: number, lz: number]
}

/**
 * Independently owned geometry for one replaceable chunk subregion.
 *
 * Consumers must replace the complete buffer previously stored for
 * `ownedRegion`; this is deliberately not a patch over a greedy full-chunk
 * mesh, whose quads may cross region boundaries.
 */
export type RegionMesh = {
  readonly dirtyRegion: MeshRegion
  readonly ownedRegion: MeshRegion
  readonly layers: MeshLayers
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

// Same convention as `kernel-adapter.ts`'s `FIRST_INDEX`/`STEP`: every bounded
// Scan in this file starts at the lowest valid coordinate and advances one
// Cell at a time, so both are named once and reused rather than re-spelled.
/** The lowest valid coordinate, array index, or lookup-table lower bound on any axis. */
const FIRST_INDEX = 0
/** The amount every bounded scan in this file advances or retreats by, per step. */
const STEP = 1

// MeshConfig's readonly Set references are retained by callers, so cache only
// The two identities that affect the layer table and keep the public builder fresh.
const LAYER_LOOKUP_CACHE = new WeakMap<object, WeakMap<object, Uint8Array>>()

const layerLookupForMesh = (config: MeshConfig): Uint8Array => {
  let byWater = LAYER_LOOKUP_CACHE.get(config.waterBlockIds)
  if (!byWater) {
    byWater = new WeakMap<object, Uint8Array>()
    LAYER_LOOKUP_CACHE.set(config.waterBlockIds, byWater)
  }
  const cached = byWater.get(config.transparentSolidBlockIds)
  if (cached) {
    return cached
  }
  const lookup = buildLayerLookup(config)
  byWater.set(config.transparentSolidBlockIds, lookup)
  return lookup
}

// Optional shape tables are derived from readonly collection identities too;
// Mesh code only reads these private tables, so the empty tables can be shared.
/** Entries in a table indexed by block id: ids run 0..MAX_BLOCK_ID inclusive. */
const BLOCK_ID_TABLE_SIZE = MAX_BLOCK_ID + STEP
const CROSS_PLANT_LOOKUP_CACHE = new WeakMap<object, Uint8Array>()
const EMPTY_CROSS_PLANT_LOOKUP = new Uint8Array(BLOCK_ID_TABLE_SIZE)

const crossPlantLookupForMesh = (config: MeshConfig): Uint8Array => {
  const blockIds = config.crossPlantBlockIds
  // `blockIds` is `ReadonlySet<number> | undefined`; a `Set`, even an empty
  // One, is always truthy, so this is exactly the `=== undefined` check
  // Without spelling the banned `undefined` identifier.
  if (!blockIds) {
    return EMPTY_CROSS_PLANT_LOOKUP
  }
  const cached = CROSS_PLANT_LOOKUP_CACHE.get(blockIds)
  if (cached) {
    return cached
  }
  const lookup = buildCrossPlantLookup(config)
  CROSS_PLANT_LOOKUP_CACHE.set(blockIds, lookup)
  return lookup
}

const FLUID_LOOKUP_CACHE = new WeakMap<object, Uint8Array>()
const EMPTY_FLUID_LOOKUP = new Uint8Array(BLOCK_ID_TABLE_SIZE)

const fluidLookupForMesh = (config: MeshConfig): Uint8Array => {
  const maxLevels = config.fluidMaxLevels
  // `maxLevels` is `ReadonlyMap<number, number> | undefined`; a `Map`, even an
  // Empty one, is always truthy, so this is exactly the `=== undefined` check
  // Without spelling the banned `undefined` identifier.
  if (!maxLevels) {
    return EMPTY_FLUID_LOOKUP
  }
  const cached = FLUID_LOOKUP_CACHE.get(maxLevels)
  if (cached) {
    return cached
  }
  const lookup = buildFluidLookup(config)
  FLUID_LOOKUP_CACHE.set(maxLevels, lookup)
  return lookup
}

/**
 * The layer a block id belongs to, read from the flattened table.
 *
 * ASSERTED, not defaulted: an id outside the table cannot happen — ids come out
 * of a `Uint8Array` and the table has `MAX_BLOCK_ID + 1` entries — so
 * `lookup[blockId]` is never `undefined`. `noUncheckedIndexedAccess` still
 * requires the assertion to typecheck; `domain/fluid-mesh.ts`'s `isFluidBlock`
 * makes the identical proof over the identically-shaped table.
 */
const layerAt = (lookup: Uint8Array, blockId: number): number => lookup[blockId]!

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
const isFaceExposed = (
  lookup: Uint8Array,
  plants: Uint8Array,
  blockId: number,
  neighbourId: number,
): boolean => {
  // A cross-plant neighbour is treated exactly as air. Two diagonal panes
  // Occupying a tenth of a cell cannot hide a face, so this is the correct
  // Answer rather than a preference — and it is a DEVIATION: the reference's
  // `isSolidFaceExposed` (`greedy-meshing-fluid-state.ts:145-157`) exposes a
  // Face only through air or a transparent solid, and plants are in neither
  // Set, so a flower beside a stone block culls that block's face there. See
  // `domain/plant-mesh.ts` and docs/design-notes.md M-11.
  //
  // A byte-indexed table read, not a `Set.has`: this is the ~400k calls/chunk
  // Path that plan.md §3.3 measures and `domain/opacity.ts` prices at 6.5x.
  if (neighbourId === AIR || isCrossPlant(plants, neighbourId)) {
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
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const columnBase = lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE
      for (let y = CHUNK_HEIGHT - STEP; y > highest; y -= STEP) {
        if ((blocks[columnBase + y] ?? AIR) !== AIR) {
          highest = y
          break
        }
      }
    }
  }
  // `highest` is the top solid index, or -1 for an all-air chunk; +STEP turns
  // That index into the exclusive upper bound the six passes scan up to.
  return highest + STEP
}

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

const faceCellBlockId = (cell: number): number => cell & MAX_BLOCK_ID

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
  readonly face: Face
  readonly mask: Uint16Array
  readonly push: (quad: Quad) => void
}

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
  if (isFaceExposed(ctx.lookup, ctx.plants, blockId, neighbourId)) {
    const ao = ambientOcclusionAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz)
    if (layerAt(ctx.lookup, blockId) === OPAQUE_LAYER) {
      ctx.mask[maskIndex] = packFaceCell(blockId, ao)
    } else {
      ctx.push({ ao, blockId, direction: ctx.face.direction, height: 1, lx, lz, role: ctx.face.role, width: 1, y })
    }
  }
}

// A plant emits no cube faces at all — it is drawn as two diagonal panes by
// `meshCrossPlants`. The reference guards all six passes the same way
// (`greedy-meshing-algorithms.ts:40, 79, 118, 157, 196, 235`); without it a
// Flower is drawn as a solid cube AND as a cross.
//
// A FLUID is skipped for the same reason and it is the stronger case: its
// Surface sits at a fractional height, so without this guard a lake is drawn
// Twice — flat at `y + 1` by this pass and again at `y + 0.875` by
// `meshFluidSurfaces` — and the two z-fight along every shoreline.
/** Is `blockId` neither air, a cross plant, nor a fluid — i.e. does it own cube faces? */
const isPaintableCell = (ctx: ColumnPassContext, blockId: number): boolean =>
  blockId !== AIR && !isCrossPlant(ctx.plants, blockId) && !isFluidBlock(ctx.fluids, blockId)

/** Fill `ctx.mask` for one +X/-X slice (`lx` fixed): mask is (`lz` outer, `y` inner). */
const fillXSliceMask = (ctx: ColumnPassContext, lx: number, yLimit: number): void => {
  const { blocks } = ctx.chunk
  const xBase = lx * CHUNK_HEIGHT * CHUNK_SIZE
  ctx.mask.fill(NO_FACE, FIRST_INDEX, CHUNK_SIZE * yLimit)
  for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
    const columnBase = xBase + lz * CHUNK_HEIGHT
    const rowBase = lz * yLimit
    for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
      const blockId = blocks[columnBase + y] ?? AIR
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
  const { blocks } = ctx.chunk
  ctx.mask.fill(NO_FACE, FIRST_INDEX, CHUNK_SIZE * CHUNK_SIZE)
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    const columnBase = lx * CHUNK_HEIGHT * CHUNK_SIZE + y
    const rowBase = lx * CHUNK_SIZE
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const blockId = blocks[columnBase + lz * CHUNK_HEIGHT] ?? AIR
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
  const { blocks } = ctx.chunk
  ctx.mask.fill(NO_FACE, FIRST_INDEX, CHUNK_SIZE * yLimit)
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    const columnBase = lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE
    const rowBase = lx * yLimit
    for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
      const blockId = blocks[columnBase + y] ?? AIR
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
const meshXPass = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  plants: Uint8Array,
  fluids: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint16Array,
  push: (quad: Quad) => void,
): void => {
  const ctx: ColumnPassContext = { chunk, face, fluids, lookup, mask, neighbours, plants, push }
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, depth) => {
    push({
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
    fillXSliceMask(ctx, lx, yLimit)
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
  plants: Uint8Array,
  fluids: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint16Array,
  push: (quad: Quad) => void,
): void => {
  const ctx: ColumnPassContext = { chunk, face, fluids, lookup, mask, neighbours, plants, push }
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, depth) => {
    push({
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

  for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
    fillYSliceMask(ctx, y)
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
  plants: Uint8Array,
  fluids: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint16Array,
  push: (quad: Quad) => void,
): void => {
  const ctx: ColumnPassContext = { chunk, face, fluids, lookup, mask, neighbours, plants, push }
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, depth) => {
    push({
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
    fillZSliceMask(ctx, lz, yLimit)
    expandGreedy(mask, CHUNK_SIZE, yLimit, emit, lz)
  }
}

/** The three per-layer sinks, and the routing rule, in one place. */
const makeSink = (
  lookup: Uint8Array,
  crossPlants: ReadonlyArray<CrossPlantQuad>,
  fluids: ReadonlyArray<FluidQuad>,
): {
  readonly layers: MeshLayers
  readonly push: (quad: Quad) => void
} => {
  const opaque: Array<Quad> = []
  const water: Array<Quad> = []
  const transparentSolid: Array<Quad> = []
  const buckets = [opaque, water, transparentSolid]
  return {
    layers: { crossPlants, fluids, opaque, transparentSolid, water },
    // MESH_LAYERS is ['opaque', 'water', 'transparentSolid'] and the lookup
    // Stores an index into it, so the routing is the index — no re-spelling of
    // The priority order, which lives in `opacity.ts` and is tested there.
    push: (quad: Quad): void => {
      // ASSERTED: `layerAt` returns an index into `MESH_LAYERS` (`buildLayerLookup`
      // Only ever writes `MESH_LAYERS.indexOf(...)`), and `buckets` has exactly
      // `MESH_LAYERS.length` entries in the same order, so the index is always
      // In range.
      const bucket = buckets[layerAt(lookup, quad.blockId)]!
      bucket.push(quad)
    },
  }
}

/** `solidCeiling`'s return value for a chunk that is entirely air. */
const EMPTY_CHUNK_CEILING = 0

/** A face normal component of this value means "no offset on this axis". */
const NO_OFFSET = 0

/** Route one face to whichever of the three axis passes its normal lies on. */
const meshFace = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  plants: Uint8Array,
  fluids: Uint8Array,
  face: Face,
  yLimit: number,
  mask: Uint16Array,
  push: (quad: Quad) => void,
): void => {
  if (face.nx !== NO_OFFSET) {
    meshXPass(chunk, neighbours, lookup, plants, fluids, face, yLimit, mask, push)
  } else if (face.ny !== NO_OFFSET) {
    meshYPass(chunk, neighbours, lookup, plants, fluids, face, yLimit, mask, push)
  } else {
    meshZPass(chunk, neighbours, lookup, plants, fluids, face, yLimit, mask, push)
  }
}

/** Mesh every face direction into `mask`/`push`, for one chunk. */
const meshAllFaces = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  plants: Uint8Array,
  fluids: Uint8Array,
  yLimit: number,
  mask: Uint16Array,
  push: (quad: Quad) => void,
): void => {
  for (const face of FACES) {
    meshFace(chunk, neighbours, lookup, plants, fluids, face, yLimit, mask, push)
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
  config: MeshConfig,
): MeshLayers => {
  const lookup = layerLookupForMesh(config)
  const plants = crossPlantLookupForMesh(config)
  const fluids = fluidLookupForMesh(config)
  const yLimit = solidCeiling(chunk.blocks)
  // Plants and fluid surfaces are meshed BEFORE the sink is built, because the
  // Sink owns the result object and both are part of it. Both are bounded by the
  // Same `yLimit`: a plant and a fluid are non-air blocks, so neither can exist
  // Above the highest one.
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants(chunk, plants, yLimit),
    meshFluidSurfaces(chunk, neighbours, fluids, lookup, plants, yLimit),
  )
  if (yLimit === EMPTY_CHUNK_CEILING) {
    return layers
  }

  // One scratch mask, sized for the largest of the three shapes and reused by
  // Every slice of every pass. Allocating per slice would be 576 typed arrays
  // Per chunk; `expandGreedy` consumes what it reads, and each pass refills the
  // Region it is about to use, so sharing is safe.
  const mask = new Uint16Array(CHUNK_SIZE * Math.max(yLimit, CHUNK_SIZE))
  meshAllFaces(chunk, neighbours, lookup, plants, fluids, yLimit, mask, push)

  return layers
}

/**
 * Everything the two UNMERGED meshers — `meshChunkNaive` (whole chunk) and
 * `meshChunkRegion` (one dirty region) — need to test and emit one candidate
 * cell for one face direction. Bundled for the same `max-params` reason as
 * `ColumnPassContext`; there is no `mask` here because neither mesher merges.
 */
type FaceScanContext = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly lookup: Uint8Array
  readonly plants: Uint8Array
  readonly fluids: Uint8Array
  readonly face: Face
  readonly push: (quad: Quad) => void
}

/**
 * Push one unit quad for `(lx, y, lz)` if it holds a paintable
 * (non-air/plant/fluid), exposed block face. Shared by both unmerged
 * meshers: they differ only in which cells they visit, never in what happens
 * once a cell is visited.
 */
const emitUnitFace = (ctx: FaceScanContext, lx: number, y: number, lz: number): void => {
  const blockId = getBlock(ctx.chunk.blocks, lx, y, lz)
  if (blockId !== AIR && !isCrossPlant(ctx.plants, blockId) && !isFluidBlock(ctx.fluids, blockId)) {
    const neighbourId = getBlockAcrossBoundary(
      ctx.chunk,
      ctx.neighbours,
      lx + ctx.face.nx,
      y + ctx.face.ny,
      lz + ctx.face.nz,
    )
    if (isFaceExposed(ctx.lookup, ctx.plants, blockId, neighbourId)) {
      ctx.push({
        ao: ambientOcclusionAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz),
        blockId,
        direction: ctx.face.direction,
        height: 1,
        lx,
        lz,
        role: ctx.face.role,
        width: 1,
        y,
      })
    }
  }
}

/** Visit every `(lx, y, lz)` cell in the whole chunk, for one face direction. */
const scanChunkFace = (ctx: FaceScanContext): void => {
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      for (let y = FIRST_INDEX; y < CHUNK_HEIGHT; y += STEP) {
        emitUnitFace(ctx, lx, y, lz)
      }
    }
  }
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
 *
 * IT COMPUTES AO, and must. `ambientOcclusionAt` is called here exactly as the
 * merged pass calls it, so the oracle carries a per-face AO for every unit face
 * and the coverage property can compare the two shade for shade. An oracle that
 * left `ao` at 0 would still pin the merge's geometry and would say nothing
 * whatever about whether the shading survived it — which is the half of the
 * merge that AO actually changed.
 */
export const meshChunkNaive = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
): MeshLayers => {
  const lookup = layerLookupForMesh(config)
  const plants = crossPlantLookupForMesh(config)
  const fluids = fluidLookupForMesh(config)
  // CHUNK_HEIGHT, not `solidCeiling`: the oracle deliberately does no such
  // Optimisation, so that `solidCeiling` itself is something the property tests
  // Can catch being wrong. The plates and the fluid surfaces are identical
  // Either way, which is exactly what makes that comparison worth making.
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants(chunk, plants, CHUNK_HEIGHT),
    meshFluidSurfaces(chunk, neighbours, fluids, lookup, plants, CHUNK_HEIGHT),
  )

  for (const face of FACES) {
    scanChunkFace({ chunk, face, fluids, lookup, neighbours, plants, push })
  }

  return layers
}

const clampInteger = (value: number, lower: number, upper: number): number => {
  // Was `Number.isFinite(value) ? value : lower`. A non-finite input (NaN,
  // +/-Infinity) has no valid position in the range, so it clamps to `lower`
  // Exactly as it did as a ternary — this is an if/else standing in for a
  // Two-armed value choice, not a change in which value wins.
  let finiteValue = lower
  if (Number.isFinite(value)) {
    finiteValue = value
  }
  return Math.min(upper, Math.max(lower, Math.trunc(finiteValue)))
}

const normalizeRegion = (region: MeshRegion): MeshRegion => {
  const [regionMinLx, regionMinY, regionMinLz] = region.min
  const [regionMaxLx, regionMaxY, regionMaxLz] = region.max
  const minX = clampInteger(regionMinLx, FIRST_INDEX, CHUNK_SIZE)
  const minY = clampInteger(regionMinY, FIRST_INDEX, CHUNK_HEIGHT)
  const minZ = clampInteger(regionMinLz, FIRST_INDEX, CHUNK_SIZE)
  return {
    max: [
      clampInteger(regionMaxLx, minX, CHUNK_SIZE),
      clampInteger(regionMaxY, minY, CHUNK_HEIGHT),
      clampInteger(regionMaxLz, minZ, CHUNK_SIZE),
    ],
    min: [minX, minY, minZ],
  }
}

/** Cells on every side of the dirty region that face-exposure/AO/fluid-corner reads can still reach. */
const HALO_CELLS = 1

/** Expand `dirty` by `HALO_CELLS` on every axis, clamped to the chunk. */
const haloRegion = (dirty: MeshRegion): MeshRegion => {
  const [dirtyMinLx, dirtyMinY, dirtyMinLz] = dirty.min
  const [dirtyMaxLx, dirtyMaxY, dirtyMaxLz] = dirty.max
  return {
    max: [
      Math.min(CHUNK_SIZE, dirtyMaxLx + HALO_CELLS),
      Math.min(CHUNK_HEIGHT, dirtyMaxY + HALO_CELLS),
      Math.min(CHUNK_SIZE, dirtyMaxLz + HALO_CELLS),
    ],
    min: [
      Math.max(FIRST_INDEX, dirtyMinLx - HALO_CELLS),
      Math.max(FIRST_INDEX, dirtyMinY - HALO_CELLS),
      Math.max(FIRST_INDEX, dirtyMinLz - HALO_CELLS),
    ],
  }
}

/** The three block-id lookup tables every mesher in this file needs, fetched together. */
const meshLookupsFor = (config: MeshConfig): { lookup: Uint8Array; plants: Uint8Array; fluids: Uint8Array } => ({
  fluids: fluidLookupForMesh(config),
  lookup: layerLookupForMesh(config),
  plants: crossPlantLookupForMesh(config),
})

/** Visit every `(lx, y, lz)` cell inside `owned`, for one face direction. */
const scanRegionFace = (ctx: FaceScanContext, owned: MeshRegion): void => {
  const [minLx, minY, minLz] = owned.min
  const [maxLx, maxY, maxLz] = owned.max
  for (let lx = minLx; lx < maxLx; lx += STEP) {
    for (let lz = minLz; lz < maxLz; lz += STEP) {
      for (let y = minY; y < maxY; y += STEP) {
        emitUnitFace(ctx, lx, y, lz)
      }
    }
  }
}

/** Mesh every face direction into `push`, for the `owned` region of one chunk. */
const meshAllRegionFaces = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  plants: Uint8Array,
  fluids: Uint8Array,
  owned: MeshRegion,
  push: (quad: Quad) => void,
): void => {
  for (const face of FACES) {
    scanRegionFace({ chunk, face, fluids, lookup, neighbours, plants, push }, owned)
  }
}

/**
 * Remesh the cells whose geometry can be affected by a dirty chunk-local AABB.
 *
 * Face exposure, AO and fluid corners read at most one neighbouring cell, so
 * `ownedRegion` is the normalized dirty region plus a one-cell halo, clamped to
 * this chunk. Output uses unit faces rather than greedy quads so every geometry
 * item has exactly one owning cell and region buffers can be replaced safely.
 */
export const meshChunkRegion = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  dirtyRegion: MeshRegion,
): RegionMesh => {
  const dirty = normalizeRegion(dirtyRegion)
  // ASSERTED: `MeshRegion.min`/`.max` are typed as exact 3-tuples, and `axis`
  // Comes from `.some`'s index over `dirty.min`, itself a 3-tuple — so
  // `dirty.max[axis]` is always in range. The `!` satisfies
  // `noUncheckedIndexedAccess`, which cannot see the tuple length through a
  // Computed index.
  const empty = dirty.min.some((value, axis) => value >= dirty.max[axis]!)
  if (empty) {
    return {
      dirtyRegion: dirty,
      layers: {
        crossPlants: [],
        fluids: [],
        opaque: [],
        transparentSolid: [],
        water: [],
      },
      ownedRegion: dirty,
    }
  }
  const owned = haloRegion(dirty)
  const [, maxY] = owned.max
  const { lookup, plants, fluids } = meshLookupsFor(config)
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants(chunk, plants, maxY, owned),
    meshFluidSurfaces(chunk, neighbours, fluids, lookup, plants, maxY, owned),
  )

  meshAllRegionFaces(chunk, neighbours, lookup, plants, fluids, owned, push)

  return {
    dirtyRegion: dirty,
    layers,
    ownedRegion: owned,
  }
}
