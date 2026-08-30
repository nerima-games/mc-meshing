/**
 * The three-valued opacity model, and why a boolean will not do.
 *
 * Stable layer vocabulary for the current 0.x mesh format.
 *
 * ---------------------------------------------------------------------------
 * A boolean `transparent` flag is INSUFFICIENT. This is measured, not opined.
 * ---------------------------------------------------------------------------
 *
 * The reference implementation keeps TWO SEPARATE transparency sets, not one:
 *
 *   packages/worker/infrastructure/meshing/meshing-worker-config.ts:7-13
 *     TRANSPARENT_IDS_ARRAY       = [WATER]
 *     TRANSPARENT_IDS_SET         = new Set(TRANSPARENT_IDS_ARRAY)
 *     TRANSPARENT_SOLID_IDS_ARRAY = [GLASS, LEAVES]
 *     TRANSPARENT_SOLID_IDS_SET   = new Set(TRANSPARENT_SOLID_IDS_ARRAY)
 *
 * and its own tests assert the distinction explicitly — TRANSPARENT_SOLID
 * "does not include WATER (fluid, not transparent-solid)"
 * (`packages/worker/test/meshing-worker-config.test.ts:69`).
 *
 * The two are not interchangeable because they are RENDERED DIFFERENTLY. Water
 * goes through a bespoke shader (ripple, refraction, animated surface, variable
 * height); glass and leaves go through the ordinary block atlas material with
 * alpha blending. Collapsing them into one boolean means one of the two renders
 * wrong, and there is no third option.
 *
 * plan.md §3.3 states the required API as
 * `mesh(chunk, neighbors, config) -> {opaque, water, transparentSolid}` with
 * priority `transparentSolid > water > opaque`. That is a THREE-valued
 * classification, so it is modelled as one here rather than as two booleans
 * whose four combinations include one that is meaningless.
 *
 * ---------------------------------------------------------------------------
 * The priority order, and what it is for
 * ---------------------------------------------------------------------------
 *
 * A block id could in principle appear in both injected sets — different
 * repositories, different reviewers, one table. Rather than treating that as an
 * error to be discovered at runtime in a worker, the classification is total
 * and ordered: transparentSolid wins, then water, then opaque. That matches the
 * reference's routing (`greedy-meshing-passes.ts:148-152`, a nested ternary in
 * the same order) and means a config mistake degrades a surface's appearance
 * rather than crashing a chunk.
 *
 * `MESH_LAYER_PRIORITY` exists so the order is a value that can be tested, not
 * a shape baked into a conditional that a future edit can silently reorder.
 */
import {
  AIR,
  MAX_BLOCK_ID,
  MINECRAFT_CROSS_PLANT_BLOCK_IDS,
  MINECRAFT_FLUID_MAX_LEVELS,
  MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS,
  MINECRAFT_WATER_BLOCK_IDS,
} from './block-data.js'

/**
 * Which geometry buffer a face belongs to.
 *
 * `opaque`           the ordinary case: fully occludes, no blending.
 * `water`            a fluid surface. Bespoke shader, variable height.
 * `transparentSolid` a solid block you can see through: glass, leaves.
 */
export type MeshLayer = 'opaque' | 'water' | 'transparentSolid'

/**
 * Highest priority first. Read this as: "when a block id is claimed by more
 * than one set, the earliest layer in this list wins".
 */
export const MESH_LAYER_PRIORITY = ['transparentSolid', 'water', 'opaque'] as const satisfies readonly [
  MeshLayer,
  MeshLayer,
  MeshLayer,
]

/** Every layer, in buffer-emission order (opaque first — it is drawn first). */
export const MESH_LAYERS = ['opaque', 'water', 'transparentSolid'] as const satisfies readonly [
  MeshLayer,
  MeshLayer,
  MeshLayer,
]

/**
 * Meshing configuration, injected by the caller.
 *
 * ---------------------------------------------------------------------------
 * THE SETS ARE NATIVE `Set`, AND THAT IS A HARD REQUIREMENT (plan.md §5.2)
 * ---------------------------------------------------------------------------
 *
 * `ReadonlySet<number>` here means the built-in TypeScript type, backed by a
 * native `Set`. Effect's `HashSet` is BANNED in this type. Its `has` compares
 * by structural equality, which for a boxed number goes through Equal/Hash
 * dispatch — MEASURED at 1.9x a native Set's hash lookup, and at 12.3x the
 * `Uint8Array` lookup the inner loop actually uses (`pnpm bench`, guard
 * `set-membership/hashset-vs-lookup-table`; see docs/testing.md §7). An earlier
 * version of this comment said "orders of magnitude", which the benchmark does
 * not support: most of the 12.3x is Set-vs-table, not HashSet-vs-Set. The
 * conclusion is unchanged and the reason is now the right one. This is on a
 * path the reference measures at roughly 400,000 calls per chunk
 * (`packages/rendering/infrastructure/meshing/greedy-meshing-passes.ts:105`:
 * "The inner mask-building loop (hot path, ~400k calls/chunk)"; 6 face passes
 * over 16 x 16 x 256 cells is 393,216, so the figure is the full six-pass cell
 * count).
 *
 * This is not a style preference and it is not negotiable. It is one of the
 * five performance exceptions plan.md §5.2 carries over from the reference,
 * every one of which was established by measurement. See docs/design-notes.md,
 * regression `meshing-transparency-sets-are-native`.
 *
 * Even a native Set is too slow in the innermost loop; see `buildLayerLookup`.
 *
 * The collection values are caller-owned and must be treated as immutable after
 * first use by a mesher. Create new collections and a new config when changing
 * block classification; internal lookup tables are memoized by collection identity.
 */
export type MeshConfig = {
  /** Fluid surfaces. Rendered with the water shader. Typically just WATER. */
  readonly waterBlockIds: ReadonlySet<number>
  /** See-through solids. Rendered with the atlas material plus alpha blending. */
  readonly transparentSolidBlockIds: ReadonlySet<number>
  /**
   * Blocks drawn as two diagonal panes rather than as a cube: flowers, tall
   * grass, mushrooms, saplings. See `domain/plant-mesh.ts`.
   *
   * A THIRD SET, not a third value of the layer model above. The other two
   * answer "which buffer does this face go in", which is a question about
   * MATERIAL; this one answers "is this a cube at all", which is a question
   * about SHAPE. A block can be both — a see-through cross plate is the normal
   * case — so collapsing them would lose one of the two answers.
   *
   */
  readonly crossPlantBlockIds: ReadonlySet<number>
  /**
   * Blocks drawn as a variable-height fluid volume rather than a cube, mapped to
   * the highest LEVEL that fluid's propagation can reach. See
   * `domain/fluid-mesh.ts`.
   *
   * A FOURTH ENTRY, and a MAP where the other three are sets, because a fluid id
   * on its own is not enough to place a surface. The height of a cell is
   * `1 - level / (maxLevel + 1)` (`greedy-meshing-fluid-state.ts:39-43`), and
   * `maxLevel` differs per fluid: the reference has 7 for water and 3 for lava
   * (`fluid-model.ts:15-16`). Naming those two numbers here would be a second
   * spelling of how far a fluid SPREADS, which is mx-gameplay's rule and not
   * this repository's — §3.2's argument for injecting `waterBlockIds`, applied
   * to the one propagation constant the geometry cannot avoid needing.
   *
   * Its KEYS are also the set of fluid ids, so one injected table answers both
   * "is this a fluid" and "how tall are its steps" in one lookup.
   *
   * LIKE `crossPlantBlockIds`, THIS ANSWERS A QUESTION ABOUT SHAPE, not about
   * material. `waterBlockIds` decides which buffer a face goes in; this decides
   * whether the block is a cube at all. Water is normally in both, and lava is
   * normally in this one only — it is a fluid, but it is not blended.
   *
   */
  readonly fluidMaxLevels: ReadonlyMap<number, number>
}

export const EMPTY_MESH_CONFIG: MeshConfig = {
  crossPlantBlockIds: new Set<number>(),
  fluidMaxLevels: new Map<number, number>(),
  transparentSolidBlockIds: new Set<number>(),
  waterBlockIds: new Set<number>(),
}

export const MINECRAFT_MESH_CONFIG: MeshConfig = {
  crossPlantBlockIds: MINECRAFT_CROSS_PLANT_BLOCK_IDS,
  fluidMaxLevels: MINECRAFT_FLUID_MAX_LEVELS,
  transparentSolidBlockIds: MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS,
  waterBlockIds: MINECRAFT_WATER_BLOCK_IDS,
}

/**
 * Classify one block id. Total: every id lands in exactly one layer.
 *
 * Correct but NOT for the inner loop — use `buildLayerLookup` there.
 */
export const layerOfBlockId = (config: MeshConfig, blockId: number): MeshLayer => {
  if (config.transparentSolidBlockIds.has(blockId)) {
    return 'transparentSolid'
  }
  if (config.waterBlockIds.has(blockId)) {
    return 'water'
  }
  return 'opaque'
}

/**
 * Flatten a `MeshConfig` into a 256-entry lookup table, indexed by block id.
 *
 * Block ids are bytes, so the whole domain fits in 256 bytes and the inner loop
 * becomes an array index instead of a hash lookup. The reference does the same
 * (`greedy-meshing.ts:41-57`, memoised on Set identity through a `WeakMap`) and
 * notes that "the resulting lookup is still faster than iterating a Set in the
 * inner meshing loop".
 *
 * Building it here is O(256). Internal mesh entry points reuse the result by
 * Set identity, while this public builder returns a fresh table for each call.
 * Values are indices into `MESH_LAYERS`.
 */
/** `MAX_BLOCK_ID` is inclusive, so the table needs one more slot than that. */
const TABLE_SIZE_OFFSET = 1

/** Loop increment for a table build that visits each block id exactly once. */
const BLOCK_ID_STEP = 1

/** Size of a byte-indexed table covering every representable block id. */
const BLOCK_ID_TABLE_SIZE = MAX_BLOCK_ID + TABLE_SIZE_OFFSET

export const buildLayerLookup = (config: MeshConfig): Uint8Array => {
  const lookup = new Uint8Array(BLOCK_ID_TABLE_SIZE)
  for (let blockId = 0; blockId <= MAX_BLOCK_ID; blockId += BLOCK_ID_STEP) {
    lookup[blockId] = MESH_LAYERS.indexOf(layerOfBlockId(config, blockId))
  }
  return lookup
}

const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')

/**
 * Does a block occlude the face of its neighbour?
 *
 * Only fully opaque solids do. Air obviously does not; water and
 * transparent solids do not either, which is what makes the underside of a lake
 * and the far side of a pane of glass render at all. Getting this wrong
 * produces the classic "the world is inside out" bug, so it is stated once,
 * here, and shared by every face pass.
 */
export const occludes = (lookup: Uint8Array, blockId: number): boolean =>
  blockId !== AIR && lookup[blockId] === OPAQUE_LAYER
