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
 * Injected corner lighting is packed beside the block id and AO. Faces with
 * different corner light values therefore remain separate, preserving the
 * lighting supplied by the caller through greedy expansion.
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
 * The greedy cube-face portion keeps the `opaque`, `water`, and
 * `transparentSolid` layers required by the original contract. `meshChunk`
 * also returns separate collections for cross plants, fluids, and kernel-defined
 * special shapes. The reference reaches the same three cube-face buckets by a
 * different route: its
 * `greedyMeshChunk` returns `GreedyMeshResult` with `opaqueRaw` / `waterRaw` /
 * `transparentSolidRaw` as zero-copy subarray VIEWS into a shared accumulator,
 * plus a lazy `toMeshed()` that slices owned copies
 * (`greedy-meshing-types.ts:70-80`). Those views are invalidated by the next
 * call, which is a real hazard and the reason the reference has a comment about
 * it. This repository returns independently owned data, so callers do not
 * inherit that invalidation hazard.
 * See docs/design-notes.md, regression `meshing-result-is-owned-not-aliased`.
 */
import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import {
  EMPTY_CHUNK_CEILING,
  FIRST_INDEX,
  STEP,
  isFaceExposed,
  layerAt,
  solidCeiling,
} from './mesh-support.js'
import { FACES, type Face, type FacePlacement, facePlacementOf } from './faces.js'
import { type MeshConfig, buildLayerLookup } from './opacity.js'
import {
  type MeshLayers,
  type MeshRegion,
  type Quad,
  type RegionMesh,
} from './mesh-types.js'
import {
  buildCrossPlantLookup,
  isCrossPlant,
  meshCrossPlants,
} from './plant-mesh.js'
import {
  buildFluidLookup,
  isFluidBlock,
  meshFluidSurfaces,
} from './fluid-mesh.js'
import {
  isSpecialBlock,
  meshSpecialBlocks,
} from './special-mesh.js'
import { AIR } from './block-data.js'
import type { CrossPlantQuad } from './plant-types.js'
import type { FluidQuad } from './fluid-types.js'
import type { MeshScratch } from './mesh-scratch.js'
import type { SpecialBlockQuad } from './special-types.js'
import { ambientOcclusionAt } from './ambient-occlusion.js'
import { meshAllFaces } from './mesh-greedy.js'
import { quadLightAt } from './light-sampling.js'
export type { MeshLayers, MeshRegion, Quad, RegionMesh } from './mesh-types.js'
export { totalQuadArea, totalQuadCount } from './mesh-types.js'

// MeshConfig collections are caller-owned and treated as immutable.
// The layer table cache uses both collection identities.
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

// Shape tables are derived from caller-owned collection identities.
// The mesh code only reads these private tables, so empty configured collections are cheap.
const CROSS_PLANT_LOOKUP_CACHE = new WeakMap<object, Uint8Array>()

const crossPlantLookupForMesh = (config: MeshConfig): Uint8Array => {
  const blockIds = config.crossPlantBlockIds
  const cached = CROSS_PLANT_LOOKUP_CACHE.get(blockIds)
  if (cached) {
    return cached
  }
  const lookup = buildCrossPlantLookup(config)
  CROSS_PLANT_LOOKUP_CACHE.set(blockIds, lookup)
  return lookup
}

const FLUID_LOOKUP_CACHE = new WeakMap<object, Uint16Array>()

const fluidLookupForMesh = (config: MeshConfig): Uint16Array => {
  const maxLevels = config.fluidMaxLevels
  const cached = FLUID_LOOKUP_CACHE.get(maxLevels)
  if (cached) {
    return cached
  }
  const lookup = buildFluidLookup(config)
  FLUID_LOOKUP_CACHE.set(maxLevels, lookup)
  return lookup
}

/**
 * Route to one of exactly three per-layer buckets by `layerAt`'s index.
 * Exported so the defensive branch (an index `layerAt` should never
 * return, since `buildLayerLookup` only ever writes `MESH_LAYERS.indexOf(...)`
 * and `buckets` has exactly `MESH_LAYERS.length` entries in the same order)
 * has a direct test instead of an untestable one buried inside `makeSink`.
 */
export const bucketFor = <Bucket,>(buckets: readonly [Bucket, Bucket, Bucket], index: number): Bucket => {
  const bucket = buckets[index]
  if (typeof bucket === 'undefined') {
    throw new RangeError(`unreachable: layer index ${index} outside the three MESH_LAYERS buckets`)
  }
  return bucket
}

/** The three per-layer sinks, and the routing rule, in one place. */
const makeSink = (
  lookup: Uint8Array,
  crossPlants: ReadonlyArray<CrossPlantQuad>,
  fluids: ReadonlyArray<FluidQuad>,
  specialBlocks: ReadonlyArray<SpecialBlockQuad>,
): {
  readonly layers: MeshLayers
  readonly push: (quad: Quad) => void
} => {
  const opaque: Array<Quad> = []
  const water: Array<Quad> = []
  const transparentSolid: Array<Quad> = []
  const buckets: readonly [Array<Quad>, Array<Quad>, Array<Quad>] = [opaque, water, transparentSolid]
  return {
    layers: { crossPlants, fluids, opaque, specialBlocks, transparentSolid, water },
    // MESH_LAYERS is ['opaque', 'water', 'transparentSolid'] and the lookup
    // Stores an index into it, so the routing is the index — no re-spelling of
    // The priority order, which lives in `opacity.ts` and is tested there.
    push: (quad: Quad): void => {
      bucketFor(buckets, layerAt(lookup, quad.blockId)).push(quad)
    },
  }
}

type ChunkMeshContext = {
  readonly fluids: Uint16Array
  readonly layers: MeshLayers
  readonly lookup: Uint8Array
  readonly plants: Uint8Array
  readonly push: (quad: Quad) => void
  readonly yLimit: number
}

const chunkMeshContextOf = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
): ChunkMeshContext => {
  const lookup = layerLookupForMesh(config)
  const plants = crossPlantLookupForMesh(config)
  const fluids = fluidLookupForMesh(config)
  const yLimit = solidCeiling(chunk.blocks, chunk.height)
  // Plants and fluid surfaces are meshed BEFORE the sink is built, because the
  // Sink owns the result object and both are part of it. Both are bounded by the
  // Same `yLimit`: a plant and a fluid are non-air blocks, so neither can exist
  // Above the highest one.
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants({ chunk, neighbours, plantLookup: plants, yLimit }),
    meshFluidSurfaces(chunk, neighbours, fluids, lookup, plants, yLimit),
    meshSpecialBlocks(chunk, neighbours, yLimit),
  )
  return { fluids, layers, lookup, plants, push, yLimit }
}

const lightMasksOf = (
  chunk: ChunkView,
  length: number,
): { block: Uint16Array; sky: Uint16Array } | undefined => {
  if (!chunk.light) {
    return
  }
  return {
    block: new Uint16Array(length),
    sky: new Uint16Array(length),
  }
}

type MeshWorkBuffers = {
  readonly mask: Uint16Array<ArrayBufferLike>
  readonly light: { block: Uint16Array; sky: Uint16Array } | undefined
}

const meshBuffersOf = (
  chunk: ChunkView,
  length: number,
  scratch: MeshScratch | undefined,
): MeshWorkBuffers => {
  const buffers = scratch?.buffersFor(length, Boolean(chunk.light))
  if (buffers) {
    return { light: buffers.light, mask: buffers.mask }
  }
  return { light: lightMasksOf(chunk, length), mask: new Uint16Array(length) }
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
  scratch?: MeshScratch,
): MeshLayers => {
  const { fluids, layers, lookup, plants, push, yLimit } = chunkMeshContextOf(chunk, neighbours, config)
  if (yLimit === EMPTY_CHUNK_CEILING) {
    return layers
  }

  const required = CHUNK_SIZE * Math.max(yLimit, CHUNK_SIZE)
  const { light, mask } = meshBuffersOf(chunk, required, scratch)
  meshAllFaces({
    chunk,
    fluids,
    light,
    lookup,
    mask,
    neighbours,
    plants,
    push,
    yLimit,
  })

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
  readonly fluids: Uint16Array
  readonly face: Face
  readonly placement: FacePlacement
  readonly push: (quad: Quad) => void
}

const lightPropertiesOf = (light: Quad['light']): Pick<Quad, 'light'> => {
  if (light) {
    return { light }
  }
  return {}
}

/**
 * Push one unit quad for `(lx, y, lz)` if it holds a paintable
 * (non-air/plant/fluid/special), exposed block face. Shared by both unmerged
 * meshers: they differ only in which cells they visit, never in what happens
 * once a cell is visited.
 */
const emitUnitFace = (ctx: FaceScanContext, lx: number, y: number, lz: number): void => {
  const blockId = getBlock(ctx.chunk, lx, y, lz)
  if (
    blockId !== AIR &&
    !isCrossPlant(ctx.plants, blockId) &&
    !isFluidBlock(ctx.fluids, blockId) &&
    !isSpecialBlock(blockId)
  ) {
    const neighbourId = getBlockAcrossBoundary(
      ctx.chunk,
      ctx.neighbours,
      lx + ctx.face.nx,
      y + ctx.face.ny,
      lz + ctx.face.nz,
    )
    if (isFaceExposed(ctx.lookup, ctx.plants, blockId, neighbourId)) {
      const light = quadLightAt(
        ctx.chunk,
        ctx.neighbours,
        ctx.face.direction,
        lx,
        y,
        lz,
      )
      ctx.push({
        ao: ambientOcclusionAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz),
        blockId,
        ...ctx.placement,
        height: 1,
        lx,
        lz,
        width: 1,
        y,
        ...lightPropertiesOf(light),
      })
    }
  }
}

/** Visit every `(lx, y, lz)` cell in the whole chunk, for one face direction. */
const scanChunkFace = (ctx: FaceScanContext): void => {
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      for (let y = FIRST_INDEX; y < ctx.chunk.height; y += STEP) {
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
  // The full chunk height, not `solidCeiling`: the oracle deliberately does no such
  // Optimisation, so that `solidCeiling` itself is something the property tests
  // Can catch being wrong. The plates and the fluid surfaces are identical
  // Either way, which is exactly what makes that comparison worth making.
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants({ chunk, neighbours, plantLookup: plants, yLimit: chunk.height }),
    meshFluidSurfaces(chunk, neighbours, fluids, lookup, plants, chunk.height),
    meshSpecialBlocks(chunk, neighbours, chunk.height),
  )

  for (const face of FACES) {
    scanChunkFace({
      chunk,
      face,
      fluids,
      lookup,
      neighbours,
      placement: facePlacementOf(face.direction),
      plants,
      push,
    })
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

const normalizeRegion = (region: MeshRegion, height: number): MeshRegion => {
  const [regionMinLx, regionMinY, regionMinLz] = region.min
  const [regionMaxLx, regionMaxY, regionMaxLz] = region.max
  const minX = clampInteger(regionMinLx, FIRST_INDEX, CHUNK_SIZE)
  const minY = clampInteger(regionMinY, FIRST_INDEX, height)
  const minZ = clampInteger(regionMinLz, FIRST_INDEX, CHUNK_SIZE)
  return {
    max: [
      clampInteger(regionMaxLx, minX, CHUNK_SIZE),
      clampInteger(regionMaxY, minY, height),
      clampInteger(regionMaxLz, minZ, CHUNK_SIZE),
    ],
    min: [minX, minY, minZ],
  }
}

const isEmptyRegion = (region: MeshRegion): boolean => {
  const [minLx, minY, minLz] = region.min
  const [maxLx, maxY, maxLz] = region.max
  return minLx >= maxLx || minY >= maxY || minLz >= maxLz
}

/** Cells on every side of the dirty region that face-exposure/AO/fluid-corner reads can still reach. */
const HALO_CELLS = 1

/** Expand `dirty` by `HALO_CELLS` on every axis, clamped to the chunk. */
const haloRegion = (dirty: MeshRegion, height: number): MeshRegion => {
  const [dirtyMinLx, dirtyMinY, dirtyMinLz] = dirty.min
  const [dirtyMaxLx, dirtyMaxY, dirtyMaxLz] = dirty.max
  return {
    max: [
      Math.min(CHUNK_SIZE, dirtyMaxLx + HALO_CELLS),
      Math.min(height, dirtyMaxY + HALO_CELLS),
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
const meshLookupsFor = (config: MeshConfig): { lookup: Uint8Array; plants: Uint8Array; fluids: Uint16Array } => ({
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
  fluids: Uint16Array,
  owned: MeshRegion,
  push: (quad: Quad) => void,
): void => {
  for (const face of FACES) {
    scanRegionFace(
      {
        chunk,
        face,
        fluids,
        lookup,
        neighbours,
        placement: facePlacementOf(face.direction),
        plants,
        push,
      },
      owned,
    )
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
  const dirty = normalizeRegion(dirtyRegion, chunk.height)
  const empty = isEmptyRegion(dirty)
  if (empty) {
    return {
      dirtyRegion: dirty,
      layers: {
        crossPlants: [],
        fluids: [],
        opaque: [],
        specialBlocks: [],
        transparentSolid: [],
        water: [],
      },
      ownedRegion: dirty,
    }
  }
  const owned = haloRegion(dirty, chunk.height)
  const [, maxY] = owned.max
  const { lookup, plants, fluids } = meshLookupsFor(config)
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants({ bounds: owned, chunk, neighbours, plantLookup: plants, yLimit: maxY }),
    meshFluidSurfaces(chunk, neighbours, fluids, lookup, plants, maxY, owned),
    meshSpecialBlocks(chunk, neighbours, maxY, owned),
  )

  meshAllRegionFaces(chunk, neighbours, lookup, plants, fluids, owned, push)

  return {
    dirtyRegion: dirty,
    layers,
    ownedRegion: owned,
  }
}
