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
import { Schema } from 'effect'
import { faceOf, tangentAxes, type QuadAxis } from './faces'
import type { MeshLayers, Quad } from './mesh'

/**
 * The levels, coarsest last. `0` is "do not simplify" and is a real level
 * rather than the absence of one, so that a caller can hold a `LodLevel`
 * unconditionally instead of a `LodLevel | undefined`.
 */
export const LOD_LEVELS = [0, 1, 2] as const

export type LodLevel = (typeof LOD_LEVELS)[number]

/**
 * Validation for a level that arrived from outside the type system — the
 * reference's use is a worker message, which crosses `postMessage` and is
 * `unknown` on the far side.
 *
 * Derived from `LOD_LEVELS` by spread rather than re-spelling `0, 1, 2`, so a
 * fourth level cannot be added to one and not the other.
 */
export const LodLevelSchema = Schema.Literal(...LOD_LEVELS)

/**
 * Blocks per LOD grid cell. The reference's `STEP_FOR_LOD`, unchanged.
 *
 * Level 0's step of 1 is what makes `simplifyMesh` a no-op there, so the "LOD 0
 * returns the input untouched" behaviour is a consequence of this table rather
 * than a separate `if` that could disagree with it.
 */
const STEP_FOR_LOD: Readonly<Record<LodLevel, number>> = { 0: 1, 1: 2, 2: 4 }

/**
 * Pack a quad's identity — its normal and its snapped box — into one number.
 *
 * Carried over from the reference verbatim, encoding included, because the
 * encoding is the interesting part. It is VARIABLE-BASE POSITIONAL, not
 * bitwise: JavaScript's bitwise operators truncate to 32 bits and this needs 38.
 * Bases are one more than each component's maximum, so the packing is injective
 * on its documented domain:
 *
 *   nx+1, ny+1, nz+1   in [0, 2]     base 3
 *   p0x, p0z, p2x, p2z in [0, 16]    base 17
 *   p0y, p2y           in [0, 256]   base 257
 *
 * Maximum key 148,944,920,282 (~1.49e11), well inside 2^53 where integers are
 * exact. The multiplications are of numeric literals only, so an engine folds
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
  Math.round(p2y) * 17 +
  Math.round(p2x) * (17 * 257) +
  Math.round(p0z) * (17 * 257 * 17) +
  Math.round(p0y) * (17 * 257 * 17 * 17) +
  Math.round(p0x) * (17 * 257 * 17 * 17 * 257) +
  (Math.round(nz) + 1) * (17 * 257 * 17 * 17 * 257 * 17) +
  (Math.round(ny) + 1) * (17 * 257 * 17 * 17 * 257 * 17 * 3) +
  (Math.round(nx) + 1) * (17 * 257 * 17 * 17 * 257 * 17 * 3 * 3)

/** The quad's origin on one axis, in chunk-local cell coordinates. */
const originOn = (quad: Quad, axis: QuadAxis): number =>
  axis === 'x' ? quad.lx : axis === 'y' ? quad.y : quad.lz

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

/** One quad, snapped onto the LOD grid. Attributes and direction are untouched. */
const snapQuad = (quad: Quad, step: number): Quad => {
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const [widthMin, widthMax] = snapSpan(quad, widthAxis, quad.width, step)
  const [heightMin, heightMax] = snapSpan(quad, heightAxis, quad.height, step)
  return {
    ...quad,
    lx: widthAxis === 'x' ? widthMin : heightAxis === 'x' ? heightMin : quad.lx,
    // Never snapped, on any face. See the header.
    y: quad.y,
    lz: widthAxis === 'z' ? widthMin : heightAxis === 'z' ? heightMin : quad.lz,
    width: widthMax - widthMin,
    height: heightMax - heightMin,
  }
}

/** The key a snapped quad dedups on: its plane, its box, and nothing else. */
const keyOf = (quad: Quad): number => {
  const face = faceOf(quad.direction)
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const maxOn = (axis: QuadAxis): number =>
    originOn(quad, axis) + (axis === widthAxis ? quad.width : axis === heightAxis ? quad.height : 0)
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
 * wins, relative order intact. So the canonical face order (`FACES`) and the
 * within-direction lx/lz/y order that `domain/mesh.ts` declares load-bearing for
 * golden hashes survive simplification, and a golden hash may be taken over a
 * simplified mesh exactly as over a full one.
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
  if (step === 1 || layers.opaque.length === 0) {
    return layers
  }

  const opaque: Array<Quad> = []
  const seen = new Set<number>()
  for (const quad of layers.opaque) {
    const snapped = snapQuad(quad, step)
    const key = keyOf(snapped)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    opaque.push(snapped)
  }

  return {
    opaque,
    water: layers.water,
    transparentSolid: layers.transparentSolid,
    // Passed through untouched, like the other two non-opaque lists and for a
    // stronger version of the same reason. `snapQuad` snaps a quad's two tangent
    // extents onto a coarser grid; a cross plate has no tangent axes and no
    // integer extents to snap, so there is nothing here that simplification
    // could even be applied to. Dropping it instead would silently delete every
    // flower in the world at the first LOD boundary.
    crossPlants: layers.crossPlants,
    // Passed through for the same reason, one step more strongly again. A fluid
    // surface has no integer extents either, AND its four corner heights are
    // shared with its neighbours' corners — snapping one quad's corner without
    // snapping the abutting one would tear a lake open along the seam between
    // them, which is a hole in the world rather than a coarser world.
    fluids: layers.fluids,
  }
}
