/**
 * The six face directions, in their canonical order.
 *
 * Stable geometry vocabulary for the current 0.x mesh format.
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

const POSITIVE_NORMAL = 1
const ZERO_NORMAL = 0
const NEGATIVE_NORMAL = -1

type FaceByDirection = {
  readonly xPos: {
    readonly direction: 'xPos'
    readonly nx: typeof POSITIVE_NORMAL
    readonly ny: typeof ZERO_NORMAL
    readonly nz: typeof ZERO_NORMAL
    readonly role: 'side'
  }
  readonly xNeg: {
    readonly direction: 'xNeg'
    readonly nx: typeof NEGATIVE_NORMAL
    readonly ny: typeof ZERO_NORMAL
    readonly nz: typeof ZERO_NORMAL
    readonly role: 'side'
  }
  readonly yPos: {
    readonly direction: 'yPos'
    readonly nx: typeof ZERO_NORMAL
    readonly ny: typeof POSITIVE_NORMAL
    readonly nz: typeof ZERO_NORMAL
    readonly role: 'top'
  }
  readonly yNeg: {
    readonly direction: 'yNeg'
    readonly nx: typeof ZERO_NORMAL
    readonly ny: typeof NEGATIVE_NORMAL
    readonly nz: typeof ZERO_NORMAL
    readonly role: 'bottom'
  }
  readonly zPos: {
    readonly direction: 'zPos'
    readonly nx: typeof ZERO_NORMAL
    readonly ny: typeof ZERO_NORMAL
    readonly nz: typeof POSITIVE_NORMAL
    readonly role: 'side'
  }
  readonly zNeg: {
    readonly direction: 'zNeg'
    readonly nx: typeof ZERO_NORMAL
    readonly ny: typeof ZERO_NORMAL
    readonly nz: typeof NEGATIVE_NORMAL
    readonly role: 'side'
  }
}

export type FaceFor<Direction extends FaceDirection> = FaceByDirection[Direction]
export type Face = FaceFor<FaceDirection>

type FacePlacementByDirection = {
  readonly [Direction in FaceDirection]: {
    readonly direction: Direction
    readonly role: FaceByDirection[Direction]['role']
  }
}

/** The direction/role pair carried by a cube quad. */
export type FacePlacementFor<Direction extends FaceDirection> = FacePlacementByDirection[Direction]
export type FacePlacement = FacePlacementFor<FaceDirection>

const FACE_PLACEMENTS = {
  xNeg: { direction: 'xNeg', role: 'side' },
  xPos: { direction: 'xPos', role: 'side' },
  yNeg: { direction: 'yNeg', role: 'bottom' },
  yPos: { direction: 'yPos', role: 'top' },
  zNeg: { direction: 'zNeg', role: 'side' },
  zPos: { direction: 'zPos', role: 'side' },
} as const satisfies FacePlacementByDirection

export const facePlacementOf = <Direction extends FaceDirection>(direction: Direction): FacePlacementFor<Direction> =>
  FACE_PLACEMENTS[direction]

const X_POS: Face = {
  direction: 'xPos',
  nx: POSITIVE_NORMAL,
  ny: ZERO_NORMAL,
  nz: ZERO_NORMAL,
  role: 'side',
}
const X_NEG: Face = {
  direction: 'xNeg',
  nx: NEGATIVE_NORMAL,
  ny: ZERO_NORMAL,
  nz: ZERO_NORMAL,
  role: 'side',
}
const Y_POS: Face = {
  direction: 'yPos',
  nx: ZERO_NORMAL,
  ny: POSITIVE_NORMAL,
  nz: ZERO_NORMAL,
  role: 'top',
}
const Y_NEG: Face = {
  direction: 'yNeg',
  nx: ZERO_NORMAL,
  ny: NEGATIVE_NORMAL,
  nz: ZERO_NORMAL,
  role: 'bottom',
}
const Z_POS: Face = {
  direction: 'zPos',
  nx: ZERO_NORMAL,
  ny: ZERO_NORMAL,
  nz: POSITIVE_NORMAL,
  role: 'side',
}
const Z_NEG: Face = {
  direction: 'zNeg',
  nx: ZERO_NORMAL,
  ny: ZERO_NORMAL,
  nz: NEGATIVE_NORMAL,
  role: 'side',
}

/**
 * CANONICAL ORDER: +X, -X, +Y, -Y, +Z, -Z.
 *
 * Changing this array invalidates every golden hash in this repository and in
 * mc-render. That is a deliberate speed bump.
 */
export const FACES = [X_POS, X_NEG, Y_POS, Y_NEG, Z_POS, Z_NEG] as const satisfies readonly [
  Face,
  Face,
  Face,
  Face,
  Face,
  Face,
]

export const FACE_DIRECTIONS: ReadonlyArray<FaceDirection> = FACES.map((face) => face.direction)

/**
 * The `Face` a direction names. Total, and the SAME OBJECT that is in `FACES`.
 *
 * A consumer holding a `Quad` has its `direction` and needs its normal —
 * `domain/lod.ts` does, to key a quad by the plane it lies in. Searching `FACES`
 * per quad would work; re-spelling the six normals next to the switch would not,
 * because then the canonical table has two copies and only one of them is the
 * one every golden hash is pinned to. Hence the six named constants above: one
 * declaration, reachable both by order and by name.
 */
export function faceOf<Direction extends FaceDirection>(direction: Direction): FaceFor<Direction>
export function faceOf(direction: FaceDirection): Face {
  switch (direction) {
    case 'xPos':
      return X_POS
    case 'xNeg':
      return X_NEG
    case 'yPos':
      return Y_POS
    case 'yNeg':
      return Y_NEG
    case 'zPos':
      return Z_POS
    default:
      return Z_NEG
  }
}

/** One of the three chunk-local axes. Not a coordinate — a choice of axis. */
export type QuadAxis = 'x' | 'y' | 'z'

type TangentAxesByDirection = {
  readonly xPos: readonly ['y', 'z']
  readonly xNeg: readonly ['y', 'z']
  readonly yPos: readonly ['x', 'z']
  readonly yNeg: readonly ['x', 'z']
  readonly zPos: readonly ['x', 'y']
  readonly zNeg: readonly ['x', 'y']
}

export type TangentAxesFor<Direction extends FaceDirection> = TangentAxesByDirection[Direction]

type OppositeDirectionByDirection = {
  readonly xPos: 'xNeg'
  readonly xNeg: 'xPos'
  readonly yPos: 'yNeg'
  readonly yNeg: 'yPos'
  readonly zPos: 'zNeg'
  readonly zNeg: 'zPos'
}

export type OppositeDirectionFor<Direction extends FaceDirection> = OppositeDirectionByDirection[Direction]

/**
 * The two axes a quad's `width` and `height` run along, in that order.
 *
 * ---------------------------------------------------------------------------
 * This was implicit until LOD simplification needed it, and implicit was wrong
 * ---------------------------------------------------------------------------
 *
 * `domain/mesh.ts` documents `Quad.width` as "extent along the face's first
 * tangent axis" and `Quad.height` as the second, and NOTHING SAID WHICH AXES
 * THOSE WERE. While every quad is 1x1 that costs nothing; the moment anything
 * reads the extents — LOD snapping now, the greedy merge next — a reader and a
 * writer who guessed differently produce a mesh that is wrong in a way no face
 * count can see, because the count is unchanged and only the shape moved.
 *
 * The convention is: the two axes that are NOT the face's normal, in x, y, z
 * order. So a top face spans (x, z), an x-facing side spans (y, z), and a
 * z-facing side spans (x, y).
 *
 * The greedy merge is free to pick a different scan order internally, but it
 * must emit quads under this convention or `simplifyMesh` will snap the wrong
 * extent. Changing it here is a mesh-format change, not a refactor.
 */
export function tangentAxes<Direction extends FaceDirection>(direction: Direction): TangentAxesFor<Direction>
export function tangentAxes(direction: FaceDirection): readonly [QuadAxis, QuadAxis] {
  switch (direction) {
    case 'xPos':
    case 'xNeg':
      return ['y', 'z']
    case 'yPos':
    case 'yNeg':
      return ['x', 'z']
    default:
      return ['x', 'y']
  }
}

/** Every face has an opposite, and it is the one with the negated normal. */
export function oppositeDirection<Direction extends FaceDirection>(direction: Direction): OppositeDirectionFor<Direction>
export function oppositeDirection(direction: FaceDirection): FaceDirection {
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
