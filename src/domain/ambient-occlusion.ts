/**
 * Ambient occlusion: how enclosed a face is, baked into the mesh.
 *
 * Ported from the reference implementation's
 * `packages/rendering/infrastructure/meshing/greedy-meshing-ao.ts` — the AO half
 * of that file (`aoXPos` .. `aoZNeg`, :15-87). The light-sampling half
 * (`sampleVoxelLight` / `sampleCornerLight`, :95-149) is NOT ported: it reads a
 * `LightGrids`, and docs/responsibility.md §3 gives the light grid to
 * mc-worldgen and says mc-meshing only reads one, which it cannot do yet
 * because there is nothing to read.
 *
 * ---------------------------------------------------------------------------
 * THE REFERENCE'S AO IS PER FACE, NOT PER VERTEX. Read this before changing it
 * ---------------------------------------------------------------------------
 *
 * The famous formulation of voxel AO (0fps, and Minecraft itself) shades each of
 * a quad's four VERTICES from the eight voxels touching that corner: three
 * neighbours per corner for the side/side/corner rule, eight around the corner
 * in total. That is not what the reference does, and porting the famous version
 * instead would be a different feature wearing the same name.
 *
 * The reference computes ONE value per face, in [0, 3], by counting how many of
 * the FOUR tangent-axis neighbours of the air cell in front of the face are
 * non-air (`greedy-meshing-ao.ts:15-25` and the five siblings; the count is
 * clamped with `count > 3 ? 3 : count` at :24, :36, :49, :62, :74, :86). It then
 * writes that single value to all four vertices —
 * `greedy-meshing-passes.ts:154`, `aoQuad[0] = ao; aoQuad[1] = ao; ...`.
 *
 * The distinction is not cosmetic, because it decides the whole interaction with
 * greedy merging:
 *
 *  - PER-VERTEX AO would make a merged quad ill-defined. A 16x1 run of faces has
 *    17 corners, not 4, and there is no set of four vertex shades that
 *    reproduces them. Per-vertex AO and merging genuinely conflict, and a mesher
 *    that wants both has to interpolate or subdivide.
 *  - PER-FACE AO does not conflict at all, PROVIDED the value joins the merge
 *    key. Then every cell a quad covers carries the same AO by construction, and
 *    that one value is exactly the quad's. See `domain/mesh.ts` and
 *    docs/design-notes.md M-10.
 *
 * The four-neighbour count is a cheaper approximation than the eight-voxel rule:
 * it cannot tell an inside corner (two faces meeting) from a face with two
 * separate neighbours, because it only counts. That is the reference's choice
 * and this is a port of the reference, not of the article.
 *
 * ---------------------------------------------------------------------------
 * What counts as an occluder: ANY non-air block. TRANSCRIBED, NOT JUSTIFIED
 * ---------------------------------------------------------------------------
 *
 * The reference tests `blocks[...] !== AIR` (`greedy-meshing-ao.ts:20-23` and
 * the five siblings). So water and glass darken their neighbours here, even
 * though `domain/opacity.ts` is careful that neither of them OCCLUDES a face.
 *
 * That asymmetry is deliberate on this side too, but it is transcribed from the
 * reference rather than measured or argued from first principles, and it is
 * recorded as such: nothing in this repository has established that a pane of
 * glass should or should not cast ambient occlusion. Using `occludes()` instead
 * would be one line and would look tidier, and it is exactly the kind of
 * plausible tidy-up plan.md §8 warns against — "use the reference as a
 * specification; do not reinvent it". The place to settle it is when lighting
 * arrives, because the reference packs AO and light into one mask cell and the
 * two would then want a single notion of what stops light. See
 * docs/design-notes.md M-10.
 *
 * ---------------------------------------------------------------------------
 * One deliberate deviation: this reads across chunk boundaries
 * ---------------------------------------------------------------------------
 *
 * The reference bails out at the chunk edge — `if (lx >= CHUNK_SIZE - 1)
 * return 0` (`greedy-meshing-ao.ts:16`), and the five siblings likewise (:28,
 * :40, :53, :66, :78). Zero is the BRIGHTEST value, so the reference draws an
 * unoccluded ring around every chunk: a bright seam exactly where two chunks
 * meet, on terrain that is continuous.
 *
 * This port reads through `getBlockAcrossBoundary` instead, so a loaded
 * neighbour contributes its blocks and the seam disappears. That is not a new
 * rule — it is M-7 (`meshing-boundary-open-when-neighbour-absent`) applied to
 * one more read: an absent neighbour reads as air, a present one is consulted.
 * With no neighbour loaded this produces the reference's answer exactly, so the
 * deviation costs nothing where the reference was right and fixes the case where
 * it was not.
 *
 * At a chunk corner, the sample can land in one of the optional diagonal
 * neighbours. A loaded diagonal is consulted; an absent one keeps the same
 * "mesh as open" answer as every other unloaded boundary.
 */
import { AIR, getBlockAcrossBoundary, type ChunkNeighbours, type ChunkView } from './chunk-view'
import { faceOf, tangentAxes, type FaceDirection, type QuadAxis } from './faces'

/**
 * Distinct ambient-occlusion values a face can carry: 0, 1, 2, 3.
 *
 * Four, because the reference clamps its neighbour count with
 * `count > 3 ? 3 : count` (`greedy-meshing-ao.ts:24`) and then packs the result
 * into the TWO bits at 8-9 of the mask cell (`greedy-meshing-passes.ts:10`,
 * `bits 8-9  ao quantized [0..3]`). Two bits is where the 3 comes from; the
 * clamp is what makes a four-neighbour count fit in it.
 */
export const AO_LEVELS = 4

/** Most occluded. The clamp ceiling, i.e. `AO_LEVELS - 1`. */
export const AO_MAX = AO_LEVELS - 1

/** Fully open — no occluding neighbour. What an isolated block's faces carry. */
export const AO_NONE = 0

/** An offset from the emitting cell to one sampled cell. */
type Offset = readonly [number, number, number]

const UNIT: Readonly<Record<QuadAxis, Offset>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

/**
 * The four offsets from the EMITTING cell to the cells whose presence darkens
 * its `direction` face.
 *
 * Each is `normal ± one tangent unit vector`: the air cell in front of the face
 * is at `normal`, and the four samples are ITS neighbours along the two axes
 * `tangentAxes` names. Derived rather than hand-transcribed six times, because
 * the six differ only in which axes those are, and six copies of one rule is six
 * places for a sign to be wrong — the reference has exactly that shape, and its
 * `aoYPos` and `aoYNeg` differ from one another by a single character
 * (`greedy-meshing-ao.ts:41` `y + 1` against :54 `y - 1`).
 *
 * Deriving it from `tangentAxes` also means the tangent convention has ONE
 * spelling in this repository (`domain/faces.ts`), so this table cannot come to
 * disagree with the one `Quad.width` and `Quad.height` are written under.
 *
 * The ORDER of the four is irrelevant — the result is a count — which is why no
 * effort is made to reproduce the reference's `y-1, y+1, z-1, z+1` sequence.
 */
const offsetsFor = (direction: FaceDirection): readonly [Offset, Offset, Offset, Offset] => {
  const face = faceOf(direction)
  const [firstAxis, secondAxis] = tangentAxes(direction)
  const along = (tangent: Offset, sign: number): Offset => [
    face.nx + sign * tangent[0],
    face.ny + sign * tangent[1],
    face.nz + sign * tangent[2],
  ]
  const first = UNIT[firstAxis]
  const second = UNIT[secondAxis]
  return [along(first, 1), along(first, -1), along(second, 1), along(second, -1)]
}

/**
 * The table, as a literal with all six keys present.
 *
 * Spelled out rather than built with `Object.fromEntries(FACES.map(...))`, which
 * is the obvious way and is the wrong one twice over: V8 gives a
 * `fromEntries` result a dictionary-mode backing store, so every lookup below
 * would be a hash probe on a string rather than an in-object field read; and the
 * result types as `{[k: string]: T}`, which under `noPropertyAccessFromIndexSignature`
 * is not the total map this needs to be. Six named fields cost six lines and are
 * checked for exhaustiveness by `satisfies`.
 */
const AO_OFFSETS = {
  xPos: offsetsFor('xPos'),
  xNeg: offsetsFor('xNeg'),
  yPos: offsetsFor('yPos'),
  yNeg: offsetsFor('yNeg'),
  zPos: offsetsFor('zPos'),
  zNeg: offsetsFor('zNeg'),
} as const satisfies Readonly<Record<FaceDirection, readonly [Offset, Offset, Offset, Offset]>>

/**
 * How occluded the `direction` face of the block at `(lx, y, lz)` is, in
 * `[0, AO_MAX]`. Higher is darker.
 *
 * A pure function of the chunk, its neighbours, the direction and the cell — it
 * does NOT depend on which faces are exposed, on the config, or on anything the
 * merge does. That is what makes it safe to put in the merge key: it regroups
 * faces without changing which faces exist, so `totalQuadArea` is untouched.
 * See `domain/mesh.ts` and docs/design-notes.md M-10.
 *
 * Called once per EXPOSED face, not once per cell, so it is off the ~400k
 * calls/chunk path plan.md §3.3 measures — at worst 12,288 calls on the
 * checkerboard fixture, which is 3% of it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS FOUR SPELLED-OUT `if`s AND NOT A LOOP OVER A HELPER
 * ---------------------------------------------------------------------------
 *
 * Because the readable version was measured and it was expensive. The first
 * draft read
 *
 *     const [first, second, third, fourth] = AO_OFFSETS[direction]
 *     const occluding = (offset: Offset): number => ... ? 0 : 1
 *     const count = occluding(first) + occluding(second) + ...
 *
 * which allocates a CLOSURE on every call — one that captures `chunk`,
 * `neighbours` and all three coordinates — plus an iterator for the array
 * destructuring. At up to 12,288 exposed faces per chunk that is 12,288 short
 * lived objects, and it measured at 2.5x to 6.9x of `meshChunk`'s whole cost on
 * this repository's bench fixtures (paired A/B, docs/design-notes.md M-10).
 *
 * That is the same mistake, in the same file family, as the one plan.md §5.2
 * forbids for `getBlock` — "an `Option` allocates a `Some` per in-bounds read,
 * hundreds of thousands of short-lived objects per chunk" — arrived at from the
 * other direction. Written out, there is no allocation at all.
 *
 * The four samples are also unrolled rather than looped for a second reason: a
 * loop would read each offset through a VARIABLE index, which
 * `noUncheckedIndexedAccess` types as `number | undefined` and which would need
 * `?? 0` fallbacks no input can reach — unreachable branches in a hot function,
 * and permanently uncoverable lines in a report this repository intends to gate
 * at 99% (docs/testing.md §3). Literal indices into a tuple have neither
 * problem.
 */
export const ambientOcclusionAt = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  direction: FaceDirection,
  lx: number,
  y: number,
  lz: number,
): number => {
  const offsets = AO_OFFSETS[direction]
  const first = offsets[0]
  const second = offsets[1]
  const third = offsets[2]
  const fourth = offsets[3]
  let count = 0
  if (getBlockAcrossBoundary(chunk, neighbours, lx + first[0], y + first[1], lz + first[2]) !== AIR) {
    count += 1
  }
  if (getBlockAcrossBoundary(chunk, neighbours, lx + second[0], y + second[1], lz + second[2]) !== AIR) {
    count += 1
  }
  if (getBlockAcrossBoundary(chunk, neighbours, lx + third[0], y + third[1], lz + third[2]) !== AIR) {
    count += 1
  }
  if (getBlockAcrossBoundary(chunk, neighbours, lx + fourth[0], y + fourth[1], lz + fourth[2]) !== AIR) {
    count += 1
  }
  return count > AO_MAX ? AO_MAX : count
}
