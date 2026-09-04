/**
 * Cross-plate plant geometry: the two diagonal panes a flower or a tuft of grass
 * is drawn as.
 *
 * Ported from the reference implementation's
 * `packages/rendering/infrastructure/meshing/plant-mesh.ts` — the CROSS-PLATE
 * part of it (`addCrossPlant`, :79-98, and the id list at :18-28). What is
 * deliberately not ported is at the bottom of this comment.
 *
 * ---------------------------------------------------------------------------
 * A cross plate is not a block face, and that is the whole design problem
 * ---------------------------------------------------------------------------
 *
 * Every other thing this repository emits is a `Quad`: an origin cell, a face
 * direction, and two integer extents. That representation is not a limitation,
 * it is the point — it is what lets the greedy merge exist, what lets
 * `simplifyMesh` snap a box onto a grid, and what lets a test expand a quad back
 * into the unit block-faces it claims.
 *
 * A cross plate fits none of it:
 *
 *  - its plane is DIAGONAL, so it has no `FaceDirection`. Its normal is not
 *    axis-aligned.
 *  - its corners are FRACTIONAL: inset by `PLANT_INSET` from the cell's walls,
 *    so the plant does not z-fight with the block it stands on.
 *  - it covers NO block face, so it contributes nothing to `totalQuadArea`, and
 *    the coverage property that the merge rests on has nothing to say about it.
 *  - two of them never merge. There is no rectangle to grow.
 *
 * So `CrossPlantQuad` carries four explicit vertices, and it travels in its own
 * list rather than in one of the three `Quad` layers. Forcing it into `Quad`
 * would mean either giving `Quad` a fractional, direction-less mode that every
 * consumer has to branch on — including `simplifyMesh`, which would then be
 * snapping something that has no extent to snap — or lying about its geometry.
 *
 * plan.md §3.3 specifies the output as `{opaque, water, transparentSolid}`, so
 * a fourth list IS a deviation from the stated API and is recorded as one; see
 * docs/design-notes.md M-11. The alternative is not "no deviation", it is a
 * deviation hidden inside `Quad`.
 *
 * ---------------------------------------------------------------------------
 * Which blocks are plants is INJECTED, for the reason §3.2 already settled
 * ---------------------------------------------------------------------------
 *
 * The reference names them: `blockTypeToIndex('DANDELION')`, `'POPPY'`,
 * `'TALL_GRASS'` and six more (`plant-mesh.ts:18-28`). This repository has no
 * block registry on purpose — docs/responsibility.md §3.2 — so the set arrives
 * through `MeshConfig` exactly as `waterBlockIds` and `transparentSolidBlockIds`
 * do, and for the same three reasons: no extra edge in the dependency graph,
 * tests may use any ids, and a resource pack cannot break meshing.
 *
 * It is a native `Set` and is flattened into a byte table before the inner loop,
 * for the reason `domain/opacity.ts` gives at length. It is consulted on the
 * ~400k calls/chunk path — once for the cell and once for its neighbour — so
 * it is not a place for a hash lookup.
 *
 * ---------------------------------------------------------------------------
 * What a plant does to the six solid passes: NOTHING, in both directions
 * ---------------------------------------------------------------------------
 *
 * 1. A plant block emits NO cube faces. The reference guards every one of the
 *    six passes with `!isPlantMeshBlockId(blockId)`
 *    (`greedy-meshing-algorithms.ts:40, 79, 118, 157, 196, 235`). Without it a
 *    flower would be drawn as a solid cube AND as a cross.
 * 2. A plant block HIDES NOTHING. This is where the port diverges, deliberately.
 *    The reference's `isSolidFaceExposed` (`greedy-meshing-fluid-state.ts:145-157`)
 *    returns `true` only for an AIR neighbour or a transparent-solid one, and
 *    plants are in neither set — so in the reference a flower standing beside a
 *    stone block CULLS that block's face, and you see through the wall past the
 *    flower. That is a bug, not a decision: nothing in the reference states it,
 *    no test covers it, and it is invisible on ordinary terrain only because a
 *    plant's horizontal neighbours are almost always air.
 *
 *    Here a cross-plant neighbour is treated exactly as air by `isFaceExposed`.
 *    A two-triangle diagonal pane occupying a tenth of a cell cannot occlude
 *    anything, so this is the semantically correct answer and not a preference.
 *    Recorded as a deviation in docs/design-notes.md M-11 and pinned by
 *    `test/plant-mesh.test.ts`.
 */
import { type BlockId, MAX_BLOCK_ID } from './block-data.js'
import { CHUNK_SIZE, type ChunkNeighbours, type ChunkView, getBlock } from './chunk-view.js'
import type { CrossPlantQuad } from './plant-types.js'
import { type MeshConfig } from './opacity.js'
import { quadLightAt } from './light-sampling.js'

export type { CrossPlantQuad, PlantVertex } from './plant-types.js'

/**
 * How far each plate is pulled in from the cell's four vertical walls.
 *
 * `0.1` — the reference's `PLANT_INSET` (`plant-mesh.ts:13`), transcribed. The
 * inset is what stops the plate from being coplanar with the neighbouring
 * block's face, which is z-fighting: two surfaces at the same depth, flickering
 * as the camera moves.
 *
 * TRANSCRIBED, NOT JUSTIFIED. The reference does not say why a tenth of a block
 * rather than the `1/16` it uses for its own thin blocks (`THIN_BLOCK_INSET`,
 * :14), and nothing here has measured it. What it buys is a function of the
 * renderer's depth precision at the draw distance, and this repository cannot
 * see a renderer. See docs/design-notes.md M-11.
 */
export const PLANT_INSET = 0.1

/**
 * One full cell, in block-local units. Each plate's far edge is inset from
 * `lx`/`lz` plus this, and its top runs from `y` to `y` plus this.
 */
const CELL_SIZE = 1

/**
 * Flatten the cross-plant id set into a `MAX_BLOCK_ID + 1`-entry byte table,
 * `1` meaning "this id is a cross plant".
 *
 * The same device as `buildLayerLookup`, kept separate rather than folded into
 * it. Folding would mean giving that table a fourth value that is not a
 * `MeshLayer`, which breaks its contract — `layerOfBlockId` returns a
 * `MeshLayer` and `test/public-api.test.ts` checks the two agree over every
 * representable id — in exchange for one byte-indexed read. The read is the
 * cheap thing here; the contract is not.
 */
/** `MAX_BLOCK_ID` is inclusive, so the table needs one more slot than that. */
const TABLE_SIZE_OFFSET = 1

/**
 * Size of a byte-indexed table covering every representable block id. The
 * same fact `domain/opacity.ts`'s `buildLayerLookup` needs, restated here
 * rather than imported — the two tables are kept deliberately separate (see
 * the comment above), and a shared size constant would be a needless coupling
 * for one arithmetic fact.
 */
const BLOCK_ID_TABLE_SIZE = MAX_BLOCK_ID + TABLE_SIZE_OFFSET

/** Marker written into the table for "this id is a cross plant". */
const CROSS_PLANT_MARKER = 1

export const buildCrossPlantLookup = (config: MeshConfig): Uint8Array => {
  const lookup = new Uint8Array(BLOCK_ID_TABLE_SIZE)
  // Iterating the SET rather than every representable id, unlike `buildLayerLookup`. That
  // One has to visit every id because it must give every id an answer; this one
  // Defaults to "not a plant" and only the named ids differ.
  //
  // THERE IS NO BOUNDS CHECK, and that is deliberate. An id outside the table is a
  // Config mistake, and the obvious `if (blockId >= 0 && blockId <= MAX_BLOCK_ID)`
  // Guard is UNREACHABLE: a write past the end of a `Uint8Array` is dropped by
  // The array itself, silently and by specification, so the guarded and
  // Unguarded versions are indistinguishable to every caller. It was written,
  // And it was removed when a mutation test could not make it fail. `domain/lod.ts`
  // Refused the reference's degenerate-span guard on the same grounds — an
  // Unreachable branch is a permanently uncoverable line and a claim no test can
  // Support. `test/plant-mesh.test.ts` keeps the out-of-range case as a
  // Statement of the resulting behaviour.
  for (const blockId of config.crossPlantBlockIds) {
    lookup[blockId] = CROSS_PLANT_MARKER
  }
  return lookup
}

/** Is this id a cross plant, per the flattened table? */
export const isCrossPlant = (lookup: Uint8Array, blockId: number): boolean =>
  lookup[blockId] === CROSS_PLANT_MARKER

/**
 * The two plates for one cell, in the reference's vertex order.
 *
 * Transcribed from `addCrossPlant` (`plant-mesh.ts:89-97`) with the world offset
 * dropped — the reference adds `offset.wx` / `offset.wz` to place the chunk in
 * the world, and docs/responsibility.md §3.3 keeps this repository chunk-local,
 * so mc-render applies the offset exactly as it already does for `Quad`.
 *
 * The two plates run on OPPOSITE diagonals: the first from the `(x0, z0)` corner
 * to `(x1, z1)`, the second from `(x1, z0)` to `(x0, z1)`. Getting both from the
 * same corner would draw two coplanar panes instead of a cross — a plant that
 * disappears when viewed from 90 degrees away, which no face count can see.
 *
 * Y is NOT inset: the plate runs the full height of the cell, `y` to `y + 1`
 * (:93-94). A plant inset vertically would float above the ground it stands on.
 */
/**
 * Every cross plate in the chunk, in `lx` then `lz` then `y` order.
 *
 * That is the reference's loop nesting (`addPlantMeshes`, `plant-mesh.ts:238-240`)
 * and it is also the order `meshChunkNaive` uses, which is convenient rather
 * than load-bearing: nothing merges here, so no ordering is forced by the
 * algorithm the way the six face passes' orders are (docs/design-notes.md M-4).
 * It is pinned by a test anyway, because a golden hash over a geometry buffer
 * does not care why an order is stable, only that it is.
 *
 * Bounded by `yLimit` like the face passes, and for the same reason: a plant is
 * a non-air block, so none can exist above the highest one. The reference caps
 * the same way (`Math.min(chunk.height, yLimit)`, :237).
 *
 * Neighbours are consulted only for injected corner lighting. Cross-plate
 * geometry itself is bounded to the chunk and does not participate in culling.
 */
/** Loop increment: visit each chunk-local coordinate exactly once. */
const LOOP_STEP = 1

/** Minimum value along a chunk-local coordinate axis. */
const AXIS_ORIGIN = 0

/** Chunk-local origin, the default lower bound for `meshCrossPlants`. */
const CHUNK_ORIGIN: readonly [number, number, number] = [AXIS_ORIGIN, AXIS_ORIGIN, AXIS_ORIGIN]

type CrossPlantBounds = {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

type CrossPlantOptions = {
  readonly bounds?: CrossPlantBounds
  readonly chunk: ChunkView
  readonly neighbours?: ChunkNeighbours
  readonly plantLookup: Uint8Array
  readonly yLimit: number
}

type PlantPlateInput = {
  readonly blockId: BlockId
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly light: CrossPlantQuad['light']
}

type CrossPlantContext = {
  readonly chunk: ChunkView
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly neighbours: ChunkNeighbours
  readonly plantLookup: Uint8Array
}

const crossPlantContextOf = ({
  bounds,
  chunk,
  neighbours,
  plantLookup,
  yLimit,
}: CrossPlantOptions): CrossPlantContext => {
  const resolvedBounds = bounds ?? { max: [CHUNK_SIZE, yLimit, CHUNK_SIZE], min: CHUNK_ORIGIN }
  const [minX, minY, minZ] = resolvedBounds.min
  const [maxX, maxBoundY, maxZ] = resolvedBounds.max
  return {
    chunk,
    maxX,
    maxY: Math.min(yLimit, maxBoundY),
    maxZ,
    minX,
    minY,
    minZ,
    neighbours: neighbours ?? {},
    plantLookup,
  }
}

const lightPropertiesOf = (light: CrossPlantQuad['light']): Pick<CrossPlantQuad, 'light'> => {
  if (light) {
    return { light }
  }
  return {}
}

const platesFor = ({ blockId, lx, y, lz, light }: PlantPlateInput): ReadonlyArray<CrossPlantQuad> => {
  const x0 = lx + PLANT_INSET
  const x1 = lx + CELL_SIZE - PLANT_INSET
  const z0 = lz + PLANT_INSET
  const z1 = lz + CELL_SIZE - PLANT_INSET
  const y0 = y
  const y1 = y + CELL_SIZE
  return [
    {
      ao: 0,
      blockId,
      nx: 0,
      ny: 0,
      nz: 1,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
    },
    {
      ao: 0,
      blockId,
      nx: 1,
      ny: 0,
      nz: 0,
      role: 'side',
      ...lightPropertiesOf(light),
      vertices: [
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z1],
        [x0, y0, z1],
      ],
    },
  ]
}

export const meshCrossPlants = (options: CrossPlantOptions): ReadonlyArray<CrossPlantQuad> => {
  const { chunk, maxX, maxY, maxZ, minX, minY, minZ, neighbours, plantLookup } = crossPlantContextOf(options)
  const plates: Array<CrossPlantQuad> = []
  for (let lx = minX; lx < maxX; lx += LOOP_STEP) {
    for (let lz = minZ; lz < maxZ; lz += LOOP_STEP) {
      for (let y = minY; y < maxY; y += LOOP_STEP) {
        const blockId = getBlock(chunk, lx, y, lz)
        if (isCrossPlant(plantLookup, blockId)) {
          plates.push(
            ...platesFor({ blockId, light: quadLightAt(chunk, neighbours, 'yPos', lx, y, lz), lx, lz, y }),
          )
        }
      }
    }
  }
  return plates
}
