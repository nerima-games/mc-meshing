/**
 * Fluid surfaces: how high the water sits in a cell, and which way it appears to
 * flow.
 *
 * Ported from the reference implementation's
 * `packages/rendering/infrastructure/meshing/greedy-meshing-fluids.ts` (205 LOC)
 * and `greedy-meshing-fluid-state.ts` (181 LOC) — the GEOMETRY halves of both.
 * What is deliberately not ported, and what could not be, is at the bottom.
 *
 * ---------------------------------------------------------------------------
 * The line this file must not cross, and where it actually runs
 * ---------------------------------------------------------------------------
 *
 * docs/responsibility.md §3 gives the fluid PROPAGATION RULE to mx-gameplay —
 * which cell receives how much fluid, how fast, and under what tick budget — and
 * keeps the MESH here. That line is not in dispute and this file does not move
 * it: nothing below decides where fluid goes.
 *
 * The line that WAS undecided is the INPUT SEAM, and §3.6 is where it was left
 * open. The reference reads a second `Uint8Array` beside `blocks` and decodes it
 * with five bit masks it does not own (`packages/block/domain/fluid.ts:9-12`).
 * Re-spelling those five masks here would put a second copy of somebody else's
 * encoding in this repository — the same shape of mistake §3.3 refused for
 * coordinates, §3.4 for LOD distances and M-11 for rail shapes.
 *
 * So the seam is drawn one step further in, at the DECODED state:
 *
 *   the simulation owns   which cells hold fluid, of what kind, at what LEVEL,
 *                         and whether the cell is a source
 *   this file owns        level -> surface height, the corner averaging that
 *                         makes a slope, which faces are exposed, and the
 *                         geometry of the side skirts
 *
 * `FluidView` (domain/chunk-view.ts) carries the first as two plain arrays, so
 * no byte layout is restated here. `maxLevel` — 7 for water and 3 for lava in the
 * reference (`fluid-model.ts:15-16`) — is a property of how a fluid SPREADS, so
 * it is injected through `MeshConfig.fluidMaxLevels` rather than named here, for
 * the three reasons §3.2 already settled for `waterBlockIds`.
 *
 * The one constant that IS this file's own is `SOURCE_SURFACE_HEIGHT`, and it is
 * a rendering decision with a rendering justification — see its comment.
 *
 * ---------------------------------------------------------------------------
 * A fluid surface is not a `Quad`, and it cannot be made into one
 * ---------------------------------------------------------------------------
 *
 * `Quad` is an origin cell, a face direction and two INTEGER extents. A fluid top
 * face has four independently fractional corner heights, so it is not a rectangle
 * in space at all — it is a bilinear patch, and the patch is the whole point: the
 * slope between the four corners is what a viewer reads as FLOW DIRECTION. Flat
 * corners are still water; sloped corners are water going somewhere.
 *
 * That also settles the merge question, and settles it the same way M-10 settled
 * per-vertex ambient occlusion. A run of N merged cells has N+1 corner heights
 * along each edge, and `Quad` has room for the two at its ends; the intermediate
 * heights have nowhere to live. Merging two fluid tops is therefore not
 * "expensive" or "not yet done" — it is not expressible, and the reference agrees
 * by construction: `meshFluidFaces` calls `addQuad` with width and height fixed
 * at `1, 1` for every fluid face it emits (`greedy-meshing-fluids.ts:56-57`).
 *
 * So `FluidQuad` carries four explicit vertices and travels in its own list, and
 * `MeshLayers` grows a fifth field. M-11 already made that move for cross plates
 * and argued it at length; this is the same move for the same reason, and the
 * alternative is again not "no deviation" but "a deviation hidden inside `Quad`".
 *
 * WHAT THIS DOES TO THE COVERAGE PROPERTY: nothing, as long as both meshers
 * exclude fluid ids from the six cube passes — and both do, exactly as both
 * exclude plants. `meshing-merge-covers-the-same-surface` compares `meshChunk`
 * against `meshChunkNaive`, and it is a statement about MERGING, not about which
 * shapes exist. Both sides see the same reduced set of block faces, so the
 * property holds unchanged in its current form. `totalQuadArea` and
 * `totalQuadCount` do not count fluid quads, for the reason they do not count
 * cross plates: they measure the block-face area the merge must conserve, and a
 * surface at height 0.875 covers no block face.
 *
 * ---------------------------------------------------------------------------
 * A fluid block emits NO cube faces, and that is why this is opt-in
 * ---------------------------------------------------------------------------
 *
 * Before this file existed, a water block was an ordinary cube whose faces went
 * to the `water` layer. If it now also produced a fluid surface, a lake would be
 * drawn twice — once flat at `y + 1` and once at `y + 0.875` — which is the exact
 * double-draw M-11's plant guard exists to prevent. So a fluid id is skipped by
 * all six passes, just as a plant id is.
 *
 * That is a behaviour change for any config that declares a fluid, so
 * `fluidMaxLevels` is OPTIONAL and absent means "no id is a fluid". A config
 * written before this file existed keeps its cube water, its quad counts and its
 * recorded baselines exactly as they were — the same compatibility M-11 gave
 * `crossPlantBlockIds`, and the reason docs/design-notes.md M-9 and M-10 keep
 * their `layered-water-glass` figures unamended.
 */
import {
  blockIndex,
  CHUNK_SIZE,
  getBlock,
  getBlockAcrossBoundary,
  type ChunkNeighbours,
  type ChunkView,
  type FluidView,
} from './chunk-view'
import { type FaceDirection } from './faces'
import { isCrossPlant } from './plant-mesh'
import { MAX_BLOCK_ID, occludes, type MeshConfig } from './opacity'

/**
 * How high a SOURCE cell's surface sits, as a fraction of the cell.
 *
 * `14/16` — the reference's `SOURCE_SURFACE_HEIGHT`
 * (`greedy-meshing-fluid-state.ts:37`), and the one constant here that this
 * repository can justify rather than merely transcribe, because the reference
 * states the reason in the same place (:32-36): a source drawn flush with the top
 * of its cell meets the grass beside it at exactly the height of the grass, and
 * the shoreline then reads as a pane of glass standing in the ground rather than
 * as water meeting land. The inset is what makes an edge visible.
 *
 * Submerged cells are unaffected: `surfaceHeightOfColumn` returns a full 1
 * whenever the same fluid sits directly above, so only the cell a viewer can
 * actually see drops. Without that, every cell of a deep lake would be inset and
 * the lake would render as a stack of separated sheets.
 *
 * Note the consequence for a level-0 NON-source cell, which the formula below
 * gives a full 1: flowing fluid at its fullest is drawn TALLER than a source.
 * That is the reference's behaviour, transcribed. For water it is invisible —
 * `maxLevel` is 7, so a level-1 cell is `1 - 1/8 = 14/16` and matches a source
 * exactly — and for lava (`maxLevel` 3) it is a real 1/8-cell step. Nothing in
 * the reference remarks on it.
 */
export const SOURCE_SURFACE_HEIGHT = 14 / 16

/** Returned instead of a height when a cell holds no fluid of the kind asked for. */
const NO_FLUID = -1

/**
 * The one empty result, shared by every chunk that has no fluid configured.
 *
 * One frozen array rather than a fresh `[]` per call: `meshChunk` and
 * `meshChunkNaive` both call `meshFluidSurfaces` on every chunk, and for a world
 * with fluids switched off that would be two throwaway allocations per chunk for
 * a value nobody can distinguish from this one.
 */
const NO_FLUID_QUADS: ReadonlyArray<FluidQuad> = Object.freeze([])

/**
 * A vertex of a fluid surface, in chunk-local coordinates. Y is FRACTIONAL;
 * X and Z are not, because a fluid cell fills its footprint exactly.
 */
export type FluidVertex = readonly [number, number, number]

/**
 * One fluid face: a top patch or a side skirt.
 *
 * Four explicit vertices in winding order, for the reason in the file header —
 * there is no origin-plus-extents description of a surface whose four corners sit
 * at four different heights.
 *
 * NO `role` AND NO NORMAL FIELDS, unlike `CrossPlantQuad`. Both are functions of
 * `direction` and `domain/faces.ts` already holds the single table that maps
 * them (`faceOf`), so carrying them here would be a second spelling of the six
 * normals — which is the thing that file's own comment says the named constants
 * exist to prevent. A cross plate had to carry them because it is DIAGONAL and
 * has no `FaceDirection`; a fluid face is axis-aligned and has one.
 */
export type FluidQuad = {
  readonly blockId: number
  /** Always `yPos`, `xPos`, `xNeg`, `zPos` or `zNeg`. Never `yNeg` — see `meshFluidSurfaces`. */
  readonly direction: FaceDirection
  readonly vertices: readonly [FluidVertex, FluidVertex, FluidVertex, FluidVertex]
  /**
   * Always 0. The reference hands every fluid face `ZERO_AO`
   * (`greedy-meshing-fluids.ts:13`, used at :52). Carried as a field rather than
   * left implicit so that the claim is in the type and a test can pin it: a
   * fluid surface is shaded by the water shader, not by cavity darkening, and
   * `domain/ambient-occlusion.ts` samples the tangent neighbours of an axis-
   * aligned unit face — which a patch at height 0.875 is not.
   */
  readonly ao: number
}

/**
 * Flatten the injected fluid table into a 256-entry byte table holding
 * `maxLevel + 1`, so that `0` means "not a fluid".
 *
 * The `+ 1` is what lets one table answer both questions the inner loop asks —
 * "is this id a fluid" and "what is its maximum level" — in one byte-indexed
 * read. The same device as `buildLayerLookup` and `buildCrossPlantLookup`, and
 * kept separate from both for the reason M-11 gives: those two tables have
 * contracts of their own that a fourth value would break.
 *
 * THERE IS NO BOUNDS CHECK, and no range check on the level, for the reason
 * `buildCrossPlantLookup` records: a write past the end of a `Uint8Array` is
 * dropped by the array itself, by specification, so a guard against it is
 * unreachable and permanently uncoverable. A `maxLevel` of 255 wraps to 0 and
 * the id then reads as "not a fluid"; that is a config mistake degrading to
 * invisible fluid rather than to a crash, and `test/fluid-mesh.test.ts` records
 * it as the resulting behaviour rather than defending a guard.
 */
export const buildFluidLookup = (config: MeshConfig): Uint8Array => {
  const lookup = new Uint8Array(MAX_BLOCK_ID + 1)
  for (const [blockId, maxLevel] of config.fluidMaxLevels ?? []) {
    lookup[blockId] = maxLevel + 1
  }
  return lookup
}

/** Is this id meshed as a fluid volume rather than as a cube? */
export const isFluidBlock = (lookup: Uint8Array, blockId: number): boolean => (lookup[blockId] ?? 0) !== 0

/** The injected maximum level for a fluid id. Only meaningful when `isFluidBlock`. */
const maxLevelOf = (lookup: Uint8Array, blockId: number): number => (lookup[blockId] ?? 1) - 1

/**
 * Surface height of one cell, as a fraction of the cell.
 *
 * `max(1 / (maxLevel + 1), 1 - level / (maxLevel + 1))` — the reference's
 * `fluidHeightForCell` (`greedy-meshing-fluid-state.ts:39-43`), transcribed. The
 * `max` is a FLOOR: the emptiest cell a fluid can occupy is still drawn as one
 * step of fluid rather than as a zero-height sheet, which would z-fight with the
 * ground it lies on and disappear at grazing angles.
 */
const heightForLevel = (level: number, maxLevel: number, source: boolean): number => {
  if (source) {
    return SOURCE_SURFACE_HEIGHT
  }
  const steps = maxLevel + 1
  const filled = 1 - level / steps
  return filled < 1 / steps ? 1 / steps : filled
}

/**
 * The per-chunk constants the sampling walk needs, bundled once.
 *
 * One object per `meshFluidSurfaces` call, not per cell. The corner averaging
 * below reaches for these on the order of thirty times per fluid cell, and the
 * reference allocates a fresh `FluidRenderState` record on every one of those
 * reads (`resolveFluidState` returns an object literal,
 * `greedy-meshing-fluid-state.ts:67-71`). This port returns NUMBERS and keeps the
 * shared state in one long-lived record instead, for the reason
 * `domain/chunk-view.ts` gives about `getBlock` and `Option`: hundreds of
 * thousands of short-lived objects per chunk is a GC pause you can see in a
 * frame graph.
 */
type FluidContext = {
  readonly fluids: Uint8Array
  readonly layers: Uint8Array
  readonly plants: Uint8Array
}

/** Fluid level of one in-range cell. A missing `FluidView` reads as all zeroes. */
const levelIn = (fluid: FluidView | undefined, index: number): number =>
  fluid === undefined ? 0 : (fluid.levels[index] ?? 0)

/** Is one in-range cell a source? A missing `FluidView` reads as all zeroes. */
const sourceIn = (fluid: FluidView | undefined, index: number): boolean =>
  fluid !== undefined && (fluid.sources[index] ?? 0) !== 0

/**
 * Height of `wantId`'s fluid in one cell of one chunk, or `NO_FLUID`.
 *
 * `lx` and `lz` must already be in range for `view` — the boundary dispatch is
 * `heightAcross`'s job.
 *
 * A MISSING `FluidView` IS NOT AN ERROR. Its arrays read as zeroes, which the
 * formula turns into a full, non-source cell, so a caller holding block ids but
 * no simulation state yet gets flat full-height fluid rather than invisible
 * fluid. That is the same "mesh as though open" instinct `getBlock` applies to an
 * absent neighbour: degrade to the answer that still shows the player a world.
 */
const heightIn = (
  view: ChunkView,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  // NO SEPARATE Y-RANGE CHECK, and that is the third time this repository has
  // reached this conclusion rather than a new opinion. `getBlock` already returns
  // the `AIR` sentinel for a `y` outside the chunk, and `wantId` is a fluid id
  // and therefore never `AIR`, so the comparison below answers the out-of-range
  // case correctly on its own. The explicit `if (y < 0 || y >= CHUNK_HEIGHT)`
  // guard was written, and the coverage report showed both its lines permanently
  // unreached — `buildCrossPlantLookup` lost its bounds check to exactly this
  // (M-11) and `domain/lod.ts` refused the reference's degenerate-span guard on
  // the same grounds. An unreachable branch is an uncoverable line and a claim no
  // test can support.
  //
  // The caller relies on this: `surfaceHeightOfColumn` probes `y + 1`, which is
  // `CHUNK_HEIGHT` for fluid on the world's top row. `test/fluid-mesh.test.ts`
  // pins that case rather than a guard.
  if (getBlock(view.blocks, lx, y, lz) !== wantId) {
    return NO_FLUID
  }
  const index = blockIndex(lx, y, lz)
  return heightForLevel(
    levelIn(view.fluid, index),
    maxLevelOf(context.fluids, wantId),
    sourceIn(view.fluid, index),
  )
}

/**
 * The same read, allowed to land one cell outside the chunk.
 *
 * CROSSING THE CHUNK BOUNDARY IS A DELIBERATE DEVIATION from the reference,
 * whose `resolveFluidState` returns null for anything outside the chunk
 * (`greedy-meshing-fluid-state.ts:52-54`) and whose fluid pass therefore emits a
 * side skirt at every chunk seam — a visible wall standing inside an otherwise
 * continuous lake, at every 16 blocks, in both axes. M-10 made the same deviation
 * for ambient occlusion and recorded it; this is that decision applied again
 * rather than a new one.
 *
 * The DIAGONAL neighbour is not reachable and reads as no fluid. `ChunkNeighbours`
 * has four entries and none of them is a corner, so at the four corner columns of
 * a chunk one of the four samples the averaging below takes is missing. That is
 * the identical limitation `getBlockAcrossBoundary` already has, so it is the
 * repository's existing shape rather than a new wart; the visible effect is a
 * corner height computed from three samples instead of four, at one column per
 * chunk corner.
 */
const heightAcross = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  if (lx < 0) {
    return neighbours.xNeg === undefined ? NO_FLUID : heightIn(neighbours.xNeg, context, CHUNK_SIZE - 1, y, lz, wantId)
  }
  if (lx >= CHUNK_SIZE) {
    return neighbours.xPos === undefined ? NO_FLUID : heightIn(neighbours.xPos, context, 0, y, lz, wantId)
  }
  if (lz < 0) {
    return neighbours.zNeg === undefined ? NO_FLUID : heightIn(neighbours.zNeg, context, lx, y, CHUNK_SIZE - 1, wantId)
  }
  if (lz >= CHUNK_SIZE) {
    return neighbours.zPos === undefined ? NO_FLUID : heightIn(neighbours.zPos, context, lx, y, 0, wantId)
  }
  return heightIn(chunk, context, lx, y, lz, wantId)
}

/**
 * The height one column contributes to a corner average, or `NO_FLUID`.
 *
 * The reference's `fluidSurfaceHeightForColumn`
 * (`greedy-meshing-fluid-state.ts:74-87`). A cell with the same fluid directly
 * above it contributes a FULL 1 rather than its own height, because it is
 * submerged and its surface is not the one being drawn. Without this rule the
 * inset of `SOURCE_SURFACE_HEIGHT` would appear at every depth and a deep lake
 * would render as a stack of separated sheets.
 */
const surfaceHeightOfColumn = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  wantId: number,
): number => {
  const here = heightAcross(chunk, neighbours, context, lx, y, lz, wantId)
  if (here === NO_FLUID) {
    return NO_FLUID
  }
  return heightAcross(chunk, neighbours, context, lx, y + 1, lz, wantId) === NO_FLUID ? here : 1
}

/**
 * One corner of the top patch: the mean of the up-to-four columns touching it.
 *
 * The reference's `fluidCornerHeightForCell`
 * (`greedy-meshing-fluid-state.ts:89-113`). THIS FUNCTION IS THE FLOW DIRECTION.
 * There is no flow vector anywhere in the reference and none here: a cell whose
 * neighbours on one side are fuller than on the other gets a higher corner on
 * that side, the patch tilts, and the tilt is what the renderer animates and what
 * a player reads as a current. Computing a direction and storing it beside the
 * quad would be a second, redundant description of the same fact.
 *
 * NO DIVISION-BY-ZERO GUARD, because there cannot be one: the caller only reaches
 * here for a cell that already resolved to `wantId`, and that cell is one of the
 * four samples of all four of its own corners. `sampleCount` is therefore at
 * least 1 always. A guard here would be the unreachable branch M-11 removed from
 * `buildCrossPlantLookup` after a mutation could not make it fail.
 */
const cornerHeight = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  cornerX: number,
  cornerZ: number,
  wantId: number,
): number => {
  let heightSum = 0
  let sampleCount = 0
  for (let sx = lx + cornerX - 1; sx <= lx + cornerX; sx += 1) {
    for (let sz = lz + cornerZ - 1; sz <= lz + cornerZ; sz += 1) {
      const height = surfaceHeightOfColumn(chunk, neighbours, context, sx, y, sz, wantId)
      if (height !== NO_FLUID) {
        heightSum += height
        sampleCount += 1
      }
    }
  }
  return heightSum / sampleCount
}

/**
 * Does this neighbour hide a fluid face?
 *
 * The reference's `isFluidFaceOccluder` (`greedy-meshing-fluid-state.ts:133-134`)
 * — only a TRULY opaque block does. Air does not, another fluid does not, and a
 * transparent solid does not, which is what makes an aquarium work: water behind
 * glass must still show its surface and its sides, or the tank renders empty.
 *
 * Expressed with `occludes` from `domain/opacity.ts` rather than re-stating the
 * layer rule, so there is one definition of "truly opaque" in the repository,
 * minus the two shapes that are not cubes:
 *
 *  - A FLUID never occludes another fluid's face. The reference reaches this by
 *    naming water and lava (`isFluidBlockId`); here it is the injected table.
 *    It matters for lava, which is NOT in the water layer and would otherwise be
 *    classified opaque and hide the face of water beside it.
 *  - A CROSS PLANT never occludes either. The reference has no such rule because
 *    its fluid pass predates none of this; the rule is M-11's, which decided that
 *    two diagonal panes filling a tenth of a cell cannot hide anything, and this
 *    is that decision applied consistently rather than a second one. M-11 noted
 *    that the AO rule and the exposure rule already disagree about plants; this
 *    does not add a third disagreement.
 */
const hidesFluidFace = (context: FluidContext, blockId: number): boolean =>
  occludes(context.layers, blockId) &&
  !isFluidBlock(context.fluids, blockId) &&
  !isCrossPlant(context.plants, blockId)

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
export const meshFluidSurfaces = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  fluids: Uint8Array,
  layers: Uint8Array,
  plants: Uint8Array,
  yLimit: number,
): ReadonlyArray<FluidQuad> => {
  // A 256-BYTE SCAN TO SKIP A 16 x yLimit x 16 WALK. Without it a config that
  // declares no fluid still pays for a whole extra traversal of the chunk that
  // can only ever find nothing — measured at 1.05-1.17x of `meshChunk` on the
  // four fluid-free bench fixtures, which is most of what fluid meshing appeared
  // to cost before this early exit existed. The table is at most 256 bytes and
  // the walk is 16,384 cells on the `flat` fixture alone, so the trade is not
  // close. See docs/design-notes.md M-12.
  //
  // Scanning the TABLE rather than testing the config keeps this correct for the
  // truncation `buildFluidLookup` documents: a max level of 255 stores 0 and is
  // not a fluid, so a non-empty config can still declare no usable fluid.
  let anyFluid = false
  for (let blockId = 0; blockId <= MAX_BLOCK_ID; blockId += 1) {
    if ((fluids[blockId] ?? 0) !== 0) {
      anyFluid = true
      break
    }
  }
  if (!anyFluid) {
    return NO_FLUID_QUADS
  }

  const quads: Array<FluidQuad> = []
  const context: FluidContext = { fluids, layers, plants }

  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let y = 0; y < yLimit; y += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const blockId = getBlock(chunk.blocks, lx, y, lz)
        if (!isFluidBlock(fluids, blockId)) {
          continue
        }
        const here = heightIn(chunk, context, lx, y, lz, blockId)

        // The four corners, named for the (cornerX, cornerZ) pair each averages
        // over, and emitted in the reference's winding order (:82-85).
        const y00 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, 0, 0, blockId)
        const y01 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, 0, 1, blockId)
        const y11 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, 1, 1, blockId)
        const y10 = y + cornerHeight(chunk, neighbours, context, lx, y, lz, 1, 0, blockId)

        // TOP. Emitted only when nothing opaque sits above AND the cell above
        // holds no fluid AT ALL — a submerged cell has no surface, and drawing
        // one would put a sheet inside the lake at every level (:68-70).
        //
        // ANY fluid, not just this one. The reference tests `aboveFluid === null`
        // (:69-70), which is false for a fluid of the OTHER kind too, so water
        // with lava directly above it draws no top there. It has to be that way
        // round: a fluid is never an occluder (`hidesFluidFace`), so if this test
        // only looked for the same kind, the first clause would not catch the
        // other kind either and the surface would be drawn inside the lava.
        const aboveId = getBlockAcrossBoundary(chunk, neighbours, lx, y + 1, lz)
        if (!hidesFluidFace(context, aboveId) && !isFluidBlock(fluids, aboveId)) {
          quads.push({
            blockId,
            direction: 'yPos',
            vertices: [
              [lx, y00, lz],
              [lx, y01, lz + 1],
              [lx + 1, y11, lz + 1],
              [lx + 1, y10, lz],
            ],
            ao: 0,
          })
        }

        pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'xPos', y10, y11)
        pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'xNeg', y01, y00)
        pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'zPos', y11, y01)
        pushSide(quads, chunk, neighbours, context, lx, y, lz, blockId, here, 'zNeg', y00, y10)
      }
    }
  }

  return quads
}

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
const pushSide = (
  quads: Array<FluidQuad>,
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  context: FluidContext,
  lx: number,
  y: number,
  lz: number,
  blockId: number,
  here: number,
  direction: 'xPos' | 'xNeg' | 'zPos' | 'zNeg',
  topNear: number,
  topFar: number,
): void => {
  const dx = direction === 'xPos' ? 1 : direction === 'xNeg' ? -1 : 0
  const dz = direction === 'zPos' ? 1 : direction === 'zNeg' ? -1 : 0

  if (hidesFluidFace(context, getBlockAcrossBoundary(chunk, neighbours, lx + dx, y, lz + dz))) {
    return
  }
  const neighbourHeight = heightAcross(chunk, neighbours, context, lx + dx, y, lz + dz, blockId)
  if (neighbourHeight !== NO_FLUID && neighbourHeight >= here) {
    return
  }
  const bottom = neighbourHeight === NO_FLUID ? y : y + neighbourHeight

  // The two ends of the wall on this side, in the reference's winding. `near`
  // and `far` name the two corners the caller already computed for this side;
  // taking them from the caller is what keeps the top of the skirt EXACTLY the
  // edge of the top patch, so the two never separate and no crack appears.
  const ends: readonly [number, number, number, number] =
    direction === 'xPos'
      ? [lx + 1, lz, lx + 1, lz + 1]
      : direction === 'xNeg'
        ? [lx, lz + 1, lx, lz]
        : direction === 'zPos'
          ? [lx + 1, lz + 1, lx, lz + 1]
          : [lx, lz, lx + 1, lz]
  const [nearX, nearZ, farX, farZ] = ends

  quads.push({
    blockId,
    direction,
    vertices: [
      [nearX, bottom, nearZ],
      [nearX, topNear, nearZ],
      [farX, topFar, farZ],
      [farX, bottom, farZ],
    ],
    ao: 0,
  })
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
 * | `meshFluidFaces` | fluids:15-205 | ported, minus lighting and the world offset |
 * | `decodeFaceLighting`, `sampleCornerLight` | state:159-180 | NOT ported. Reads `LightGrids`, which §3 gives to mc-worldgen |
 * | `isSolidFaceExposed` | state:145-157 | NOT ported. It is the CUBE passes' rule, and `domain/mesh.ts` already has its own — see M-12 |
 * | `decodeFluidByte` and the five masks | `fluid.ts:9-30` | NOT ported. The encoding is the simulation's; see the file header |
 * | the accumulator routing `transparentLookup ? water : opaque` | fluids:43 | NOT ported. This repository returns lists, and the routing that answers "which buffer" already lives in `domain/opacity.ts` |
 */
