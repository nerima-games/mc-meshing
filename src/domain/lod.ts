/**
 * LOD simplification: the same surface, coarser, for a chunk that is far away.
 *
 * Ported from the reference implementation's
 * `packages/rendering/infrastructure/meshing/lod-simplification.ts` (288 LOC) —
 * the HALF of that file that takes no coordinates.
 *
 * ---------------------------------------------------------------------------
 * Why half a file, and which half
 * ---------------------------------------------------------------------------
 *
 * docs/responsibility.md §3.4 settled the split. `simplifyMesh` is a pure
 * function of a mesh and a level number, exactly the shape `meshChunk` already
 * has, so it belongs here. `lodForDistance` and its two thresholds
 * (`LOD1_DISTANCE_CHUNKS = 4`, `LOD2_DISTANCE_CHUNKS = 8`) take the distance
 * between the player's chunk and this one, which is a coordinate derivative,
 * and §3.3 says this repository holds no coordinates — so they are mc-render's.
 *
 * That split only works because the VOCABULARY lives on this side: mc-render
 * decides which level a chunk is at, and this file decides what a level means.
 * `LodLevel`, `LOD_LEVELS` and `LodLevelSchema` are therefore exported from
 * here even though the code that picks a level is not.
 *
 * docs/responsibility.md §3.5 records what mc-render would have to measure to
 * justify 4 and 8, and what the reduction counts in docs/design-notes.md M-8
 * already imply about them. Neither number is measurable in this repository:
 * both are about apparent error at a viewing distance, and this repository
 * cannot see a viewer.
 *
 * ---------------------------------------------------------------------------
 * What simplification actually does
 * ---------------------------------------------------------------------------
 *
 * Snap each quad's horizontal extents outward onto a coarser grid — 2 blocks at
 * LOD 1, 4 at LOD 2 — and then drop any quad that lands on a cell some earlier
 * quad already covers. The dropping is where the reduction comes from; the
 * snapping only makes quads collide. Removing an exactly-coincident quad cannot
 * open a hole, because the survivor covers the same area.
 *
 * Y IS NEVER SNAPPED, on any face. A hill's silhouette is its vertical extent,
 * and a silhouette that jumps when a chunk crosses a LOD threshold is the one
 * artefact a player reads as a pop rather than as distance. The reference says
 * the same thing in its own comment and this port keeps it.
 *
 * The consequence is that the reduction is ANISOTROPIC and the two axes are not
 * equal partners: a top or bottom face is snapped on both of its axes and so a
 * `step` x `step` block of them collapses to one (a factor of step^2), while a
 * side face is snapped on one axis only and collapses by a factor of step. This
 * is not a defect — it is the price of keeping the silhouette — but it means
 * "LOD 1 gives ~25-30% of the vertices", which the reference's header claims,
 * is only true for a mesh dominated by top faces. See docs/design-notes.md M-8
 * for what it actually measures at on this repository's bench fixtures.
 */
import type { MeshLayers, Quad } from './mesh.js'
import { type QuadAxis, faceOf, tangentAxes } from './faces.js'
import { Schema } from 'effect'

/** Do not simplify: the level `simplifyMesh` returns its input unchanged for. */
const LOD_LEVEL_NONE = 0

/** First (finer) simplification tier. */
const LOD_LEVEL_1 = 1

/** Second (coarser) simplification tier. */
const LOD_LEVEL_2 = 2

/**
 * The levels, coarsest last. `0` is "do not simplify" and is a real level
 * rather than the absence of one, so that a caller can hold a `LodLevel`
 * unconditionally instead of a `LodLevel | undefined`.
 */
export const LOD_LEVELS: readonly [0, 1, 2] = [LOD_LEVEL_NONE, LOD_LEVEL_1, LOD_LEVEL_2] as const

export type LodLevel = (typeof LOD_LEVELS)[number]

/**
 * Validation for a level that arrived from outside the type system — the
 * reference's use is a worker message, which crosses `postMessage` and is
 * `unknown` on the far side.
 *
 * Derived from `LOD_LEVELS` by spread rather than re-spelling `0, 1, 2`, so a
 * fourth level cannot be added to one and not the other.
 */
export const LodLevelSchema: Schema.Schema<LodLevel> = Schema.Literal(...LOD_LEVELS)

/**
 * Blocks per LOD grid cell. The reference's `STEP_FOR_LOD`, unchanged.
 *
 * Level 0's step of 1 is what makes `simplifyMesh` a no-op there, so the "LOD 0
 * returns the input untouched" behaviour is a consequence of this table rather
 * than a separate `if` that could disagree with it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS EXPORTED, HAVING BEEN PRIVATE
 * ---------------------------------------------------------------------------
 *
 * It is the input to a measurement this repository cannot make. docs/responsibility.md
 * §3.5(a) states the apparent-error formula mc-render needs in order to justify
 * `LOD1_DISTANCE_CHUNKS` and `LOD2_DISTANCE_CHUNKS` — the two constants §3.4
 * assigns to that repository — and its numerator is `step - 1`:
 *
 *   error[px] = (step - 1) / (16 * d) * H / (2 * tan(fov_v / 2))
 *
 * `step - 1` is the furthest a single edge can move when `simplifyMesh` snaps a
 * quad's extents outward onto the coarser grid, which is a fact about THIS
 * FILE's mechanism and about nothing else. Keeping the table private would have
 * left mc-render two options, and both are defects this project has a recorded
 * instance of:
 *
 *   RE-SPELL `{ 0: 1, 1: 2, 2: 4 }` over there — docs/design-notes.md and the
 *   organisation's own retrospective list "two or more hand-written lists
 *   stating the same thing" with six instances, all of which eventually
 *   disagreed. This one would disagree silently and in the worst place: a
 *   stale copy makes the error formula report a number that is wrong by the
 *   ratio of the two steps, and the reader has no way to tell, because the
 *   formula's output is a plausible pixel count either way.
 *
 *   HARD-CODE THE ERRORS instead of computing them — which is the shape of all
 *   eight "constant backed by a wrong measurement" defects: the conclusion is
 *   right and the evidence is not, so a reader who checks the evidence starts
 *   doubting the conclusion too.
 *
 * Exported, mc-render MIRRORS it (`mc-render/domain/lod-vocabulary.ts`) and
 * mc-dev-meta's `check:mirrors` compares the two tables by value on every run.
 * The duplication still exists — the mirror規律 is that every mirror is a copy —
 * but it is now a copy a gate reads, which is the difference between a
 * duplication and a divergence.
 *
 * NOTE the type: `Readonly<Record<LodLevel, number>>` and not a wider
 * `Record<number, number>`. A caller cannot index it with an unvalidated number
 * and get `undefined` back at runtime while the type says otherwise; it has to
 * hold a `LodLevel` first, which `LodLevelSchema` above is how you obtain from
 * data that came off a `postMessage`.
 */
export const STEP_FOR_LOD: Readonly<Record<LodLevel, number>> = { 0: 1, 1: 2, 2: 4 }

/**
 * Positional bases for `packQuadKey`'s packed key. Named after the value each
 * bounds, one more than its maximum so the packing is injective on its
 * documented domain:
 *
 *   nx+1, ny+1, nz+1   in [0, 2]     base 3   -> NORMAL_COMPONENT_BASE
 *   p0x, p0z, p2x, p2z in [0, 16]    base 17  -> HORIZONTAL_COORD_BASE
 *   p0y, p2y           in [0, 256]   base 257 -> VERTICAL_COORD_BASE
 */
const NORMAL_COMPONENT_BASE = 3
const HORIZONTAL_COORD_BASE = 17
const VERTICAL_COORD_BASE = 257

/** Shifts a signed unit normal component (-1, 0, 1) into the packed range [0, 2]. */
const NORMAL_COMPONENT_OFFSET = 1

/**
 * Place values for `packQuadKey`'s packed key, one per packed field, each the
 * product of every base that comes before it. Computed from
 * `NORMAL_COMPONENT_BASE`/`HORIZONTAL_COORD_BASE`/`VERTICAL_COORD_BASE` rather
 * than re-spelled, so the two can never drift apart: change a base and every
 * place value that uses it moves with it.
 */
const PLACE_P2Y = HORIZONTAL_COORD_BASE
const PLACE_P2X = PLACE_P2Y * VERTICAL_COORD_BASE
const PLACE_P0Z = PLACE_P2X * HORIZONTAL_COORD_BASE
const PLACE_P0Y = PLACE_P0Z * HORIZONTAL_COORD_BASE
const PLACE_P0X = PLACE_P0Y * VERTICAL_COORD_BASE
const PLACE_NZ = PLACE_P0X * HORIZONTAL_COORD_BASE
const PLACE_NY = PLACE_NZ * NORMAL_COMPONENT_BASE
const PLACE_NX = PLACE_NY * NORMAL_COMPONENT_BASE

/**
 * Pack a quad's identity — its normal and its snapped box — into one number.
 *
 * Carried over from the reference verbatim, encoding included, because the
 * encoding is the interesting part. It is VARIABLE-BASE POSITIONAL, not
 * bitwise: JavaScript's bitwise operators truncate to 32 bits and this needs 38.
 * Bases are one more than each component's maximum, so the packing is injective
 * on its documented domain — see `NORMAL_COMPONENT_BASE` and its siblings above
 * for the table, and `PLACE_P2Y` and its siblings for the place value each base
 * contributes.
 *
 * Maximum key 148,944,920,282 (~1.49e11), well inside 2^53 where integers are
 * exact. The multiplications are of named constants only, so an engine folds
 * them; there is no runtime cost to writing them out.
 *
 * The reference's alternative was a template literal per quad, which allocates a
 * string in the dedup loop for every quad in every chunk at every LOD change.
 *
 * `Math.round` survives the port even though every caller here passes integers:
 * the function is exported, and a non-integral argument would otherwise produce
 * a key that silently fails to collide with the quad it should have matched.
 */
export const packQuadKey = (
  nx: number,
  ny: number,
  nz: number,
  p0x: number,
  p0y: number,
  p0z: number,
  p2x: number,
  p2y: number,
  p2z: number,
): number =>
  Math.round(p2z) +
  Math.round(p2y) * PLACE_P2Y +
  Math.round(p2x) * PLACE_P2X +
  Math.round(p0z) * PLACE_P0Z +
  Math.round(p0y) * PLACE_P0Y +
  Math.round(p0x) * PLACE_P0X +
  (Math.round(nz) + NORMAL_COMPONENT_OFFSET) * PLACE_NZ +
  (Math.round(ny) + NORMAL_COMPONENT_OFFSET) * PLACE_NY +
  (Math.round(nx) + NORMAL_COMPONENT_OFFSET) * PLACE_NX

/** The quad's origin on one axis, in chunk-local cell coordinates. */
const originOn = (quad: Quad, axis: QuadAxis): number => {
  if (axis === 'x') {
    return quad.lx
  }
  if (axis === 'y') {
    return quad.y
  }
  return quad.lz
}

/**
 * `[min, max]` for one TANGENT axis of a quad, snapped outward to the grid.
 *
 * Only ever called on a tangent axis, never on the normal's: the quad is flat
 * along its normal, and snapping a zero-length span would push the face onto a
 * different plane — i.e. move the surface rather than coarsen it.
 *
 * The reference guards here against `snapMin === snapMax`, which can only happen
 * for a zero-length span, and widens it to a whole cell. That guard is NOT
 * ported. `meshChunk` never emits a zero-extent quad, so it was unreachable
 * there too (the reference marks it `c8 ignore`); and were one ever to arrive,
 * widening it invents a step x step surface where the caller said there was
 * none, which is a worse answer than passing the degenerate quad through
 * unchanged.
 */
const snapSpan = (
  quad: Quad,
  axis: QuadAxis,
  length: number,
  step: number,
): readonly [number, number] => {
  const origin = originOn(quad, axis)
  if (axis === 'y') {
    return [origin, origin + length]
  }
  return [Math.floor(origin / step) * step, Math.ceil((origin + length) / step) * step]
}

/**
 * The snapped `lx` for a quad whose two tangent axes are `widthAxis` /
 * `heightAxis`: when `'x'` is one of them it contributes its snapped min; the
 * quad has no `'x'` extent to snap along its own normal, so `quad.lx` survives
 * unchanged in that case.
 *
 * ONLY `widthAxis` IS CHECKED AGAINST `'x'`, not `heightAxis` too. `tangentAxes`
 * has exactly three possible results — `['y','z']`, `['x','z']`, `['x','y']` —
 * and in every one of them `'x'`, when present at all, is the FIRST element,
 * i.e. `widthAxis`. So `heightAxis === 'x' && widthAxis !== 'x'` cannot occur
 * for any `FaceDirection`, and a second check for it would be the unreachable
 * branch `domain/plant-mesh.ts`'s `buildCrossPlantLookup` already refused: a
 * permanently uncoverable line and a claim no test can support.
 */
const snappedLx = (widthAxis: QuadAxis, widthMin: number, quad: Quad): number => {
  if (widthAxis === 'x') {
    return widthMin
  }
  return quad.lx
}

/**
 * The snapped `lz`, by the same rule as `snappedLx` with `'z'` in place of
 * `'x'` — except `'z'`'s position in `tangentAxes`' three results is the
 * mirror image of `'x'`'s: it is always the SECOND element (`heightAxis`) when
 * present, never the first, so this checks `heightAxis` where `snappedLx`
 * checks `widthAxis`.
 */
const snappedLz = (heightAxis: QuadAxis, heightMin: number, quad: Quad): number => {
  if (heightAxis === 'z') {
    return heightMin
  }
  return quad.lz
}

/** One quad, snapped onto the LOD grid. Attributes and direction are untouched. */
const snapQuad = (quad: Quad, step: number): Quad => {
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const [widthMin, widthMax] = snapSpan(quad, widthAxis, quad.width, step)
  const [heightMin, heightMax] = snapSpan(quad, heightAxis, quad.height, step)
  return {
    ...quad,
    height: heightMax - heightMin,
    lx: snappedLx(widthAxis, widthMin, quad),
    lz: snappedLz(heightAxis, heightMin, quad),
    width: widthMax - widthMin,
    // Never snapped, on any face. See the header.
    y: quad.y,
  }
}

/** A quad's extent along an axis that is neither its width axis nor its height axis, i.e. its own normal. */
const NORMAL_AXIS_EXTENT = 0

/** The key a snapped quad dedups on: its plane, its box, and nothing else. */
const keyOf = (quad: Quad): number => {
  const face = faceOf(quad.direction)
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const maxOn = (axis: QuadAxis): number => {
    if (axis === widthAxis) {
      return originOn(quad, axis) + quad.width
    }
    if (axis === heightAxis) {
      return originOn(quad, axis) + quad.height
    }
    return originOn(quad, axis) + NORMAL_AXIS_EXTENT
  }
  return packQuadKey(
    face.nx,
    face.ny,
    face.nz,
    quad.lx,
    quad.y,
    quad.lz,
    maxOn('x'),
    maxOn('y'),
    maxOn('z'),
  )
}

/** `STEP_FOR_LOD[LOD_LEVEL_NONE]`: the step at which `simplifyMesh` is a no-op. */
const NO_SIMPLIFICATION_STEP = 1

/** The quad count of an already-empty opaque layer: nothing to simplify. */
const NO_QUADS = 0

/**
 * Snap every quad in `quads` onto the LOD grid for `step`, keeping the first
 * quad to land on each snapped cell and dropping the rest.
 *
 * Emission order is preserved — first occurrence of each snapped cell wins,
 * relative order intact — which is load-bearing; see `simplifyMesh`'s header.
 *
 * The guard is inverted (keep-if-unseen) rather than skip-if-seen with a
 * `continue`, so the loop has one path through it instead of two: the two are
 * equivalent for every input, since either way a quad is pushed at most once,
 * exactly when its key has not been seen before.
 */
const simplifyOpaqueQuads = (quads: ReadonlyArray<Quad>, step: number): Array<Quad> => {
  const opaque: Array<Quad> = []
  const seen = new Set<number>()
  for (const quad of quads) {
    const snapped = snapQuad(quad, step)
    const key = keyOf(snapped)
    if (!seen.has(key)) {
      seen.add(key)
      opaque.push(snapped)
    }
  }
  return opaque
}

/**
 * Simplify a meshed chunk to the requested LOD.
 *
 * PURE: a function of `(layers, level)` and of nothing else. No coordinates, no
 * clock, no randomness, no allocation the caller can observe. Calling it twice
 * on the same input returns equal output, and the input is not touched.
 *
 * ---------------------------------------------------------------------------
 * Only the opaque layer is simplified
 * ---------------------------------------------------------------------------
 *
 * `water` and `transparentSolid` come back as the SAME arrays that went in.
 * That is the reference's rule — `meshing-worker.ts:135` reads
 * `lod === 0 ? meshed.opaque : simplifyMesh(meshed.opaque, lod)` and never
 * passes it anything else — and its reason is that a water surface is thin and
 * is only ever visually dominant when the player is standing in it, i.e. at a
 * distance where no LOD applies. What moves in the port is WHERE the rule
 * lives: the reference states it at every call site, and `MeshLayers` bundles
 * all three layers, so here it is stated once, inside, where a second caller
 * cannot forget it.
 *
 * ---------------------------------------------------------------------------
 * Emission order is preserved, and that is load-bearing
 * ---------------------------------------------------------------------------
 *
 * The output is the input filtered — first occurrence of each snapped cell
 * wins, relative order intact, via `simplifyOpaqueQuads` below. So the
 * canonical face order (`FACES`) and the within-direction lx/lz/y order that
 * `domain/mesh.ts` declares load-bearing for golden hashes survive
 * simplification, and a golden hash may be taken over a simplified mesh
 * exactly as over a full one.
 *
 * What DOES change is which block a surviving quad reports. The key is the
 * plane and the box; it does not include `blockId`. Two quads of different
 * blocks that snap onto one cell collapse to the one that came first, so a
 * distant hillside can shift from grass to stone at a LOD boundary. That is the
 * reference's behaviour and it is the point of the exercise — a LOD that
 * preserved every texture boundary would have nothing to remove — but it is a
 * VISIBLE change, not merely a cheaper one, and it is why mc-render must not
 * apply this to a chunk the player can see in detail.
 */
export const simplifyMesh = (layers: MeshLayers, level: LodLevel): MeshLayers => {
  const step = STEP_FOR_LOD[level]
  if (step === NO_SIMPLIFICATION_STEP || layers.opaque.length === NO_QUADS) {
    return layers
  }

  const opaque = simplifyOpaqueQuads(layers.opaque, step)

  return {
    // Passed through untouched, like the other two non-opaque lists and for a
    // Stronger version of the same reason. `snapQuad` snaps a quad's two tangent
    // Extents onto a coarser grid; a cross plate has no tangent axes and no
    // Integer extents to snap, so there is nothing here that simplification
    // Could even be applied to. Dropping it instead would silently delete every
    // Flower in the world at the first LOD boundary.
    crossPlants: layers.crossPlants,
    // Passed through for the same reason, one step more strongly again. A fluid
    // Surface has no integer extents either, AND its four corner heights are
    // Shared with its neighbours' corners — snapping one quad's corner without
    // Snapping the abutting one would tear a lake open along the seam between
    // Them, which is a hole in the world rather than a coarser world.
    fluids: layers.fluids,
    opaque,
    specialBlocks: layers.specialBlocks,
    transparentSolid: layers.transparentSolid,
    water: layers.water,
  }
}
