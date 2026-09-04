/** Fluid surface geometry. State sampling and boundary traversal live in `fluid-sampling.ts`. */
import type { BlockId } from './block-data.js'
import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import {
  type FluidPosition,
  type FluidSpace,
  cornerHeight,
  flowAt,
  heightAcross,
  heightIn,
  hidesFluidFace,
  isFluidBlock,
} from './fluid-sampling.js'
import { type FluidQuad, NO_FLUID_QUADS } from './fluid-types.js'
import { quadLightAt } from './light-sampling.js'

export type { FluidFlow, FluidQuad, FluidVertex } from './fluid-types.js'
export { buildFluidLookup, isFluidBlock, SOURCE_SURFACE_HEIGHT } from './fluid-sampling.js'

const NO_FLUID = -1
const FLUID_LOOKUP_UNSET = 0
const CELL_SPAN = 1
const LOOP_STEP = 1
const ZERO_INDEX = 0
const CORNER_NEAR = 0
const CORNER_FAR = 1
const CORNER_NEAR_NEAR_INDEX = 0
const CORNER_NEAR_FAR_INDEX = 1
const CORNER_FAR_FAR_INDEX = 2
const CORNER_FAR_NEAR_INDEX = 3
const POSITION_X_INDEX = 0
const POSITION_Y_INDEX = 1
const POSITION_Z_INDEX = 2
const SIDE_HIDDEN_HEIGHT = NO_FLUID - CELL_SPAN
const AXIS_POSITIVE_STEP = 1
const AXIS_NEGATIVE_STEP = -1
const AXIS_NO_STEP = 0

const lightPropertiesOf = (light: FluidQuad['light']): Pick<FluidQuad, 'light'> => {
  if (light) {
    return { light }
  }
  return {}
}

type FluidDirection = 'xPos' | 'xNeg' | 'zPos' | 'zNeg'

type FluidCell = {
  readonly space: FluidSpace
  readonly position: FluidPosition
  readonly blockId: BlockId
  readonly here: number
  readonly corners: readonly [number, number, number, number]
}

/**
 * Every fluid face in the chunk, in `lx` then `y` then `lz` order.
 *
 * That is the reference's loop nesting (`greedy-meshing-fluids.ts:61-63`) and it
 * is kept because a golden hash over a geometry buffer needs a stable order,
 * whatever the reason for it. Nothing merges here, so unlike the six cube passes
 * no ordering is forced by the algorithm (docs/design-notes.md M-4).
 *
 * Bounded by `yLimit` like the cube passes and for the same reason: fluid is a
 * non-air block, so none exists above the highest one. The reference caps the
 * same way and says so in the same words (:24-26).
 *
 * FIVE FACES, NEVER SIX. There is no `yNeg` case, because the reference has none
 * — its fluid pass emits a top and four sides (:70, :92, :120, :148, :176) and
 * nothing else. So the underside of a lake is not drawn, and a player swimming
 * below one sees through it. That is transcribed, not endorsed: nothing in the
 * reference states it and no test there covers it. It is recorded in
 * docs/design-notes.md M-12 as the one place this port left a visible gap rather
 * than invent geometry the reference does not have.
 */
/**
 * One side skirt, if the neighbour on that side leaves a step to cover.
 *
 * The four side blocks of the reference (`greedy-meshing-fluids.ts:91-201`) are
 * one function here rather than four transcribed blocks. They differ only in the
 * neighbour offset, the two top corners the skirt hangs from, and the winding, and
 * the reference's own four copies differ from each other by exactly those — so
 * four copies would be four places for a corner index to be mistyped, which is a
 * fault no face count can see.
 *
 * THE BOTTOM EDGE IS THE NEIGHBOUR'S SURFACE, not the floor of the cell
 * (:94-97). A skirt only has to cover the STEP between this cell's surface and
 * the neighbour's; running it to `y` instead would bury a wall of fluid inside
 * the lake wherever two fluid cells of different height meet. When the neighbour
 * holds no fluid of this kind the step is the whole cell, so the bottom is `y`.
 *
 * AND THE SKIRT IS SKIPPED WHEN THE NEIGHBOUR IS AT LEAST AS HIGH (:97). Two
 * cells at equal height share a surface and need nothing between them; a taller
 * neighbour covers this cell's step from its own side.
 */
/** The (dx, dz) neighbour step for each side direction `pushSide` can be called with. */
const SIDE_STEP: Readonly<Record<FluidDirection, readonly [dx: number, dz: number]>> = {
  xNeg: [AXIS_NEGATIVE_STEP, AXIS_NO_STEP],
  xPos: [AXIS_POSITIVE_STEP, AXIS_NO_STEP],
  zNeg: [AXIS_NO_STEP, AXIS_NEGATIVE_STEP],
  zPos: [AXIS_NO_STEP, AXIS_POSITIVE_STEP],
}

/** A literal-typed corner index, so indexing `corners` (a 4-tuple) with one stays defined, never `T | undefined`. */
type CornerIndex = 0 | 1 | 2 | 3

const SIDE_CORNER_INDICES: Readonly<Record<FluidDirection, readonly [near: CornerIndex, far: CornerIndex]>> = {
  xNeg: [CORNER_NEAR_FAR_INDEX, CORNER_NEAR_NEAR_INDEX],
  xPos: [CORNER_FAR_NEAR_INDEX, CORNER_FAR_FAR_INDEX],
  zNeg: [CORNER_NEAR_NEAR_INDEX, CORNER_FAR_NEAR_INDEX],
  zPos: [CORNER_FAR_FAR_INDEX, CORNER_NEAR_FAR_INDEX],
}

/**
 * The two corners a side skirt hangs between, in the reference's winding for
 * that direction. Matches the `topNear`/`topFar` pair the caller already
 * computed, so the skirt's top edge is exactly the top patch's edge and the
 * two never separate.
 */
const sideEnds = (
  direction: FluidDirection,
  lx: number,
  lz: number,
): readonly [number, number, number, number] => {
  if (direction === 'xPos') {
    return [lx + CELL_SPAN, lz, lx + CELL_SPAN, lz + CELL_SPAN]
  }
  if (direction === 'xNeg') {
    return [lx, lz + CELL_SPAN, lx, lz]
  }
  if (direction === 'zPos') {
    return [lx + CELL_SPAN, lz + CELL_SPAN, lx, lz + CELL_SPAN]
  }
  return [lx, lz, lx + CELL_SPAN, lz]
}

/** The bottom edge of a side skirt: the neighbour's surface, or the whole cell when it holds no fluid of this kind. */
const bottomOf = (y: number, neighbourHeight: number): number => {
  if (neighbourHeight === NO_FLUID) {
    return y
  }
  return y + neighbourHeight
}

const sideNeighbourHeight = (cell: FluidCell, direction: FluidDirection): number => {
  const { space, position, blockId } = cell
  const { chunk, context, neighbours } = space
  const [lx, y, lz] = position
  const [dx, dz] = SIDE_STEP[direction]
  if (hidesFluidFace(context, getBlockAcrossBoundary(chunk, neighbours, lx + dx, y, lz + dz))) {
    return SIDE_HIDDEN_HEIGHT
  }
  return heightAcross(space, [lx + dx, y, lz + dz], blockId)
}

const pushSide = (
  quads: Array<FluidQuad>,
  cell: FluidCell,
  direction: FluidDirection,
): void => {
  const { space, position, here, corners } = cell
  const neighbourHeight = sideNeighbourHeight(cell, direction)
  if (neighbourHeight === SIDE_HIDDEN_HEIGHT || (neighbourHeight !== NO_FLUID && neighbourHeight >= here)) {
    return
  }
  const bottom = bottomOf(position[POSITION_Y_INDEX], neighbourHeight)

  // `near` and `far` name the two corners the caller already computed for
  // This side; taking them from the caller is what keeps the top of the
  // Skirt EXACTLY the edge of the top patch, so the two never separate.
  const [nearX, nearZ, farX, farZ] = sideEnds(direction, position[POSITION_X_INDEX], position[POSITION_Z_INDEX])
  const [nearIndex, farIndex] = SIDE_CORNER_INDICES[direction]
  const light = quadLightAt(
    space.chunk,
    space.neighbours,
    direction,
    position[POSITION_X_INDEX],
    position[POSITION_Y_INDEX],
    position[POSITION_Z_INDEX],
  )

  quads.push({
    ao: 0,
    blockId: cell.blockId,
    direction,
    vertices: [
      [nearX, bottom, nearZ],
      [nearX, corners[nearIndex], nearZ],
      [farX, corners[farIndex], farZ],
      [farX, bottom, farZ],
    ],
    ...lightPropertiesOf(light),
  })
}

/**
 * Does the injected fluid table declare any fluid at all?
 *
 * A SMALL LOOKUP-TABLE SCAN TO SKIP A 16 x yLimit x 16 WALK. Without it a config
 * that declares no fluid still pays for a whole extra traversal of the chunk
 * that can only ever find nothing — measured at 1.05-1.17x of `meshChunk` on
 * the four fluid-free bench fixtures, which is most of what fluid meshing
 * appeared to cost before this early exit existed. The table has
 * `MAX_BLOCK_ID + 1` entries and the walk is 16,384 cells on the `flat`
 * fixture alone, so the trade is not close. See docs/design-notes.md M-12.
 *
 * Scanning the TABLE rather than testing the config keeps this correct when the
 * lookup is derived from a caller-owned map and also keeps the early exit tied
 * to the same representation used by `isFluidBlock`.
 */
const anyFluidConfigured = (fluids: Uint16Array): boolean => {
  // Iterating the table by VALUE, not by indexing `fluids[blockId]` over a
  // `blockId` loop counter, is what keeps this branch-free: a `Uint16Array`
  // iterator always yields a defined `number` (never `undefined`), so there
  // is no unreachable-but-still-typed branch to guard or assert away.
  for (const entry of fluids) {
    if (entry !== FLUID_LOOKUP_UNSET) {
      return true
    }
  }
  return false
}

/**
 * Push the top patch for one fluid cell, unless something hides it.
 *
 * TOP. Emitted only when nothing opaque sits above AND the cell above holds
 * no fluid AT ALL — a submerged cell has no surface, and drawing one would
 * put a sheet inside the lake at every level (:68-70).
 *
 * ANY fluid, not just this one. The reference tests `aboveFluid === null`
 * (:69-70), which is false for a fluid of the OTHER kind too, so water with
 * lava directly above it draws no top there. It has to be that way round: a
 * fluid is never an occluder (`hidesFluidFace`), so if this test only looked
 * for the same kind, the first clause would not catch the other kind either
 * and the surface would be drawn inside the lava.
 */
const pushTopFace = (
  quads: Array<FluidQuad>,
  cell: FluidCell,
): void => {
  const { space, position, blockId, corners } = cell
  const { chunk, neighbours, context } = space
  const [lx, y, lz] = position
  const aboveId = getBlockAcrossBoundary(chunk, neighbours, lx, y + CELL_SPAN, lz)
  if (hidesFluidFace(context, aboveId) || isFluidBlock(context.fluids, aboveId)) {
    return
  }
  const [y00, y01, y11, y10] = corners
  const light = quadLightAt(chunk, neighbours, 'yPos', lx, y, lz)
  quads.push({
    ao: 0,
    blockId,
    direction: 'yPos',
    flow: flowAt(cell),
    vertices: [
      [lx, y00, lz],
      [lx, y01, lz + CELL_SPAN],
      [lx + CELL_SPAN, y11, lz + CELL_SPAN],
      [lx + CELL_SPAN, y10, lz],
    ],
    ...lightPropertiesOf(light),
  })
}

/**
 * The four corners of one cell's top patch, named for the (cornerX, cornerZ)
 * pair each averages over, and returned in the reference's winding order
 * (:82-85): near-near, near-far, far-far, far-near.
 */
const topPatchCorners = (
  space: FluidSpace,
  position: FluidPosition,
  blockId: BlockId,
): readonly [number, number, number, number] => {
  const [, y] = position
  const y00 = y + cornerHeight(space, position, [CORNER_NEAR, CORNER_NEAR], blockId)
  const y01 = y + cornerHeight(space, position, [CORNER_NEAR, CORNER_FAR], blockId)
  const y11 = y + cornerHeight(space, position, [CORNER_FAR, CORNER_FAR], blockId)
  const y10 = y + cornerHeight(space, position, [CORNER_FAR, CORNER_NEAR], blockId)
  return [y00, y01, y11, y10]
}

/**
 * Every fluid face for one cell already known to hold `blockId`'s fluid: the
 * top patch (if visible) and the four side skirts.
 */
const meshFluidCell = (
  quads: Array<FluidQuad>,
  space: FluidSpace,
  position: FluidPosition,
  blockId: BlockId,
): void => {
  const cell: FluidCell = {
    blockId,
    corners: topPatchCorners(space, position, blockId),
    here: heightIn(space, position, blockId),
    position,
    space,
  }

  pushTopFace(quads, cell)

  pushSide(quads, cell, 'xPos')
  pushSide(quads, cell, 'xNeg')
  pushSide(quads, cell, 'zPos')
  pushSide(quads, cell, 'zNeg')
}

/**
 * Every fluid face in the chunk, in `lx` then `y` then `lz` order — see
 * `meshFluidSurfaces`'s own comment for why that order and why `yLimit`.
 */
const meshFluidCellsInBounds = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  fluids: Uint16Array,
  layers: Uint8Array,
  plants: Uint8Array,
  yLimit: number,
  bounds: {
    readonly min: readonly [number, number, number]
    readonly max: readonly [number, number, number]
  },
): ReadonlyArray<FluidQuad> => {
  const quads: Array<FluidQuad> = []
  const space: FluidSpace = {
    chunk,
    context: { fluids, layers, plants },
    neighbours,
  }
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = [bounds.min, bounds.max]

  for (let lx = minX; lx < maxX; lx += LOOP_STEP) {
    for (let y = minY; y < Math.min(yLimit, maxY); y += LOOP_STEP) {
      for (let lz = minZ; lz < maxZ; lz += LOOP_STEP) {
        const blockId = getBlock(chunk, lx, y, lz)
        if (isFluidBlock(fluids, blockId)) {
          meshFluidCell(quads, space, [lx, y, lz], blockId)
        }
      }
    }
  }

  return quads
}

export const meshFluidSurfaces = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  fluids: Uint16Array,
  layers: Uint8Array,
  plants: Uint8Array,
  yLimit: number,
  bounds: {
    readonly min: readonly [number, number, number]
    readonly max: readonly [number, number, number]
  } = { max: [CHUNK_SIZE, yLimit, CHUNK_SIZE], min: [ZERO_INDEX, ZERO_INDEX, ZERO_INDEX] },
): ReadonlyArray<FluidQuad> => {
  if (!anyFluidConfigured(fluids)) {
    return NO_FLUID_QUADS
  }
  return meshFluidCellsInBounds(chunk, neighbours, fluids, layers, plants, yLimit, bounds)
}

/*
 * What of the two reference files is NOT here. Kept as a comment rather than as
 * an exported note, because it is provenance and not API.
 *
 * | reference | lines | status |
 * | --- | --- | --- |
 * | `fluidHeightForCell`, `resolveFluidState` | state:39-72 | ported, minus the byte decode |
 * | `fluidSurfaceHeightForColumn`, `fluidCornerHeightForCell`, `fluidTopCornerYsForCell` | state:74-127 | ported |
 * | `isFluidFaceOccluder` | state:133-134 | ported |
 * | `meshFluidFaces` | fluids:15-205 | ported, minus the world offset |
 * | `decodeFaceLighting`, `sampleCornerLight` | state:159-180 | ported through injected corner light views |
 * | `isSolidFaceExposed` | state:145-157 | NOT ported. It is the CUBE passes' rule, and `domain/mesh.ts` already has its own — see M-12 |
 * | `decodeFluidByte` and the five masks | `fluid.ts:9-30` | NOT ported. The encoding is the simulation's; see the file header |
 * | the accumulator routing `transparentLookup ? water : opaque` | fluids:43 | NOT ported. This repository returns lists, and the routing that answers "which buffer" already lives in `domain/opacity.ts` |
 */
