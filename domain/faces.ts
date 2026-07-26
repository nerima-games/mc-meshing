/**
 * The six face directions, in their canonical order.
 *
 * FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * Why the order is fixed and testable
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.3 requires golden tests that hash a geometry buffer. A hash is
 * only stable if the emission order is stable, so the order cannot be an
 * accident of how the six pass functions happen to be called — it has to be a
 * value.
 *
 * The order below is the reference implementation's, verified against the call
 * sequence at
 * `packages/rendering/infrastructure/meshing/greedy-meshing.ts:122-128`:
 *
 *   meshXPosFace, meshXNegFace, meshYPosFace, meshYNegFace, meshZPosFace, meshZNegFace
 *
 * i.e. +X, -X, +Y, -Y, +Z, -Z. Keeping it identical means the reference's
 * fixtures remain usable as an oracle (plan.md §8: "use the reference as a
 * specification; do not reinvent it").
 */

/** A face direction name. The six axis-aligned normals of a cube. */
export type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg'

/**
 * The role a face plays for texturing. The reference distinguishes exactly
 * these three (`greedy-meshing-algorithms.ts:23, 62, 101, 140, 179, 218`),
 * because a grass block needs a different texture on its top, its sides and its
 * bottom, and nothing finer than that is ever needed.
 */
export type FaceRole = 'top' | 'bottom' | 'side'

export type Face = {
  readonly direction: FaceDirection
  /** Unit normal, integral components. */
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** Offset to the neighbouring cell across this face. Equal to the normal. */
  readonly role: FaceRole
}

/**
 * CANONICAL ORDER: +X, -X, +Y, -Y, +Z, -Z.
 *
 * Changing this array invalidates every golden hash in this repository and in
 * mc-render. That is a deliberate speed bump.
 */
export const FACES: ReadonlyArray<Face> = [
  { direction: 'xPos', nx: 1, ny: 0, nz: 0, role: 'side' },
  { direction: 'xNeg', nx: -1, ny: 0, nz: 0, role: 'side' },
  { direction: 'yPos', nx: 0, ny: 1, nz: 0, role: 'top' },
  { direction: 'yNeg', nx: 0, ny: -1, nz: 0, role: 'bottom' },
  { direction: 'zPos', nx: 0, ny: 0, nz: 1, role: 'side' },
  { direction: 'zNeg', nx: 0, ny: 0, nz: -1, role: 'side' },
]

export const FACE_DIRECTIONS: ReadonlyArray<FaceDirection> = FACES.map((face) => face.direction)

/** Every face has an opposite, and it is the one with the negated normal. */
export const oppositeDirection = (direction: FaceDirection): FaceDirection => {
  switch (direction) {
    case 'xPos':
      return 'xNeg'
    case 'xNeg':
      return 'xPos'
    case 'yPos':
      return 'yNeg'
    case 'yNeg':
      return 'yPos'
    case 'zPos':
      return 'zNeg'
    default:
      return 'zPos'
  }
}

/** Vertices per quad, and indices per quad, in the emitted buffers. */
export const VERTICES_PER_QUAD = 4
export const INDICES_PER_QUAD = 6
