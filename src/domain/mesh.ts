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
 * one element per column-length stride and measurably wastes the line it just pulled in.
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
import { Result } from 'effect'
import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  type ChunkViewFailure,
  getBlock,
  getBlockAcrossBoundary,
  validateChunkViews,
} from './chunk-view.js'
import {
  EMPTY_CHUNK_CEILING,
  FIRST_INDEX,
  STEP,
  isFaceExposed,
  layerAt,
  layerLookupFromTable,
  type LayerLookup,
  type LayerLookupTableFailure,
  solidCeiling,
} from './mesh-support.js'
import { FACES, type Face, type FacePlacement, facePlacementOf } from './faces.js'
import {
  type LayerLookupFailure,
  type MeshConfig,
  buildLayerLookup,
} from './opacity.js'
import {
  type MeshLayers,
  type MeshRegion,
  type Quad,
  type RegionMesh,
} from './mesh-types.js'
import {
  buildCrossPlantLookup,
  type CrossPlantLookupFailure,
  isCrossPlant,
  meshCrossPlants,
} from './plant-mesh.js'
import {
  buildFluidLookup,
  type FluidLookupFailure,
  isFluidBlock,
  meshFluidSurfaces,
} from './fluid-mesh.js'
import {
  SPECIAL_BLOCK_LOOKUP,
  isSpecialBlock,
  meshSpecialBlocks,
  type SpecialBlockLookup,
  type SpecialMeshFailure,
  type SpecialMeshRegion,
} from './special-mesh.js'
import { validateFluidViews, type FluidViewFailure } from './fluid-sampling.js'
import { AIR } from './block-data.js'
import type { CrossPlantQuad } from './plant-types.js'
import type { FluidQuad } from './fluid-types.js'
import type { MeshScratch, MeshScratchFailure } from './mesh-scratch.js'
import type { SpecialBlockQuad } from './special-types.js'
import { ambientOcclusionAt } from './ambient-occlusion.js'
import { meshAllFaces, type GreedyMaskFailure } from './mesh-greedy.js'
import { quadLightAt } from './light-sampling.js'
export type { MeshLayers, MeshRegion, Quad, RegionMesh } from './mesh-types.js'
export { totalQuadArea, totalQuadCount } from './mesh-types.js'

// Config objects and their collections are immutable after first use. A new
// config object always gets its own validation and lookup build.
type LayerLookupFailureWithTable = LayerLookupFailure | LayerLookupTableFailure

const LAYER_LOOKUP_CACHE = new WeakMap<MeshConfig, Result.Result<LayerLookup, LayerLookupFailureWithTable>>()

const layerLookupForMesh = (config: MeshConfig): Result.Result<LayerLookup, LayerLookupFailureWithTable> => {
  const cached = LAYER_LOOKUP_CACHE.get(config)
  if (typeof cached !== 'undefined') {
    return cached
  }
  const lookup = Result.flatMap(buildLayerLookup(config), layerLookupFromTable)
  LAYER_LOOKUP_CACHE.set(config, lookup)
  return lookup
}

// Shape tables are derived from caller-owned collection identities.
// The mesh code only reads these private tables, so empty configured collections are cheap.
const CROSS_PLANT_LOOKUP_CACHE = new WeakMap<object, Result.Result<Uint8Array, CrossPlantLookupFailure>>()

const crossPlantLookupForMesh = (config: MeshConfig): Result.Result<Uint8Array, CrossPlantLookupFailure> => {
  const blockIds = config.crossPlantBlockIds
  const cached = CROSS_PLANT_LOOKUP_CACHE.get(blockIds)
  if (typeof cached !== 'undefined') {
    return cached
  }
  const lookup = buildCrossPlantLookup(config)
  CROSS_PLANT_LOOKUP_CACHE.set(blockIds, lookup)
  return lookup
}

const FLUID_LOOKUP_CACHE = new WeakMap<object, Result.Result<Uint16Array, FluidLookupFailure>>()

const fluidLookupForMesh = (config: MeshConfig): Result.Result<Uint16Array, FluidLookupFailure> => {
  const maxLevels = config.fluidMaxLevels
  const cached = FLUID_LOOKUP_CACHE.get(maxLevels)
  if (typeof cached !== 'undefined') {
    return cached
  }
  const lookup = buildFluidLookup(config)
  FLUID_LOOKUP_CACHE.set(maxLevels, lookup)
  return lookup
}

/**
 * Resolve a bucket for a layer index supplied outside the validated mesh loop.
 */
export type BucketFailure = { readonly _tag: 'InvalidMeshLayerIndex'; readonly index: number }

export const bucketFor = <Bucket,>(
  buckets: readonly [Bucket, Bucket, Bucket],
  index: number,
): Result.Result<Bucket, BucketFailure> => {
  const bucket = buckets[index]
  if (typeof bucket === 'undefined') {
    return Result.fail({ _tag: 'InvalidMeshLayerIndex', index })
  }
  return Result.succeed(bucket)
}

/** The three per-layer sinks, and the routing rule, in one place. */
const makeSink = (
  lookup: LayerLookup,
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
  return {
    layers: { crossPlants, fluids, opaque, specialBlocks, transparentSolid, water },
    // MESH_LAYERS is ['opaque', 'water', 'transparentSolid'] and the lookup
    // Stores an index into it, so the routing is the index — no re-spelling of
    // The priority order, which lives in `opacity.ts` and is tested there.
    push: (quad: Quad): void => {
      const layer = layerAt(lookup, quad.blockId)
      if (layer === 0) {
        opaque.push(quad)
      } else if (layer === 1) {
        water.push(quad)
      } else {
        // `layerLookupFromTable` checked every value against MESH_LAYERS once.
        transparentSolid.push(quad)
      }
    },
  }
}

type ChunkMeshContext = {
  readonly fluids: Uint16Array
  readonly layers: MeshLayers
  readonly lookup: LayerLookup
  readonly plants: Uint8Array
  readonly specialLookup: SpecialBlockLookup
  readonly push: (quad: Quad) => void
  readonly yLimit: number
}

const fullSpecialRegion = (yLimit: number): SpecialMeshRegion => ({
  max: [CHUNK_SIZE, yLimit, CHUNK_SIZE],
  min: [FIRST_INDEX, FIRST_INDEX, FIRST_INDEX],
})

const chunkMeshContextOf = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  specialLookup: SpecialBlockLookup,
): Result.Result<
  ChunkMeshContext,
  LayerLookupFailureWithTable | FluidLookupFailure | FluidViewFailure | CrossPlantLookupFailure | SpecialMeshFailure
> =>
  Result.flatMap(layerLookupForMesh(config), (lookup) =>
    Result.flatMap(fluidLookupForMesh(config), (fluids) => {
      return Result.flatMap(crossPlantLookupForMesh(config), (plants) => {
        const yLimit = solidCeiling(chunk.blocks, chunk.height)
        return Result.flatMap(
          meshSpecialBlocks(specialLookup, chunk, neighbours, yLimit, fullSpecialRegion(yLimit), config),
          (specialBlocks) =>
          Result.map(meshFluidSurfaces(chunk, neighbours, fluids, lookup.table, plants, yLimit), (fluidQuads) => {
            // These companion layers are built before the sink so the returned
            // result owns each list alongside the cube-face buckets.
            const { layers, push } = makeSink(
              lookup,
              meshCrossPlants({ chunk, neighbours, plantLookup: plants, yLimit }),
              fluidQuads,
              specialBlocks,
            )
            return { fluids, layers, lookup, plants, specialLookup, push, yLimit }
          }),
        )
      })
    }),
  )

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
  readonly mask: Uint32Array<ArrayBufferLike>
  readonly light: { block: Uint16Array; sky: Uint16Array } | undefined
}

const meshBuffersOf = (
  chunk: ChunkView,
  length: number,
  scratch: MeshScratch | undefined,
): Result.Result<MeshWorkBuffers, MeshScratchFailure> => {
  if (scratch) {
    return Result.map(scratch.buffersFor(length, Boolean(chunk.light)), (buffers) => ({
      light: buffers.light,
      mask: buffers.mask,
    }))
  }
  return Result.succeed({ light: lightMasksOf(chunk, length), mask: new Uint32Array(length) })
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
): Result.Result<
  MeshLayers,
  ChunkViewFailure | LayerLookupFailureWithTable | FluidLookupFailure | FluidViewFailure | CrossPlantLookupFailure | SpecialMeshFailure | MeshScratchFailure | GreedyMaskFailure
> =>
  Result.flatMap(validateChunkViews(chunk, neighbours), () =>
    Result.flatMap(SPECIAL_BLOCK_LOOKUP, (specialLookup) =>
      Result.flatMap(chunkMeshContextOf(chunk, neighbours, config, specialLookup), (context) => {
        const { fluids, layers, lookup, plants, push, yLimit } = context
        if (yLimit === EMPTY_CHUNK_CEILING) {
          return Result.succeed(layers)
        }

        const required = CHUNK_SIZE * Math.max(yLimit, CHUNK_SIZE)
        return Result.flatMap(meshBuffersOf(chunk, required, scratch), ({ light, mask }) =>
          Result.map(meshAllFaces({
            chunk,
            fluids,
            light,
            lookup,
            mask,
            neighbours,
            plants,
            specialLookup,
            push,
            yLimit,
          }), () => layers),
        )
      }),
    ),
  )

/**
 * Everything the two UNMERGED meshers — `meshChunkNaive` (whole chunk) and
 * `meshChunkRegion` (one dirty region) — need to test and emit one candidate
 * cell for one face direction. Bundled for the same `max-params` reason as
 * `ColumnPassContext`; there is no `mask` here because neither mesher merges.
 */
type FaceScanContext = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly lookup: LayerLookup
  readonly plants: Uint8Array
  readonly specialLookup: SpecialBlockLookup
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
    !isSpecialBlock(ctx.specialLookup, blockId)
  ) {
    const neighbourId = getBlockAcrossBoundary(
      ctx.chunk,
      ctx.neighbours,
      lx + ctx.face.nx,
      y + ctx.face.ny,
      lz + ctx.face.nz,
    )
    if (isFaceExposed(ctx, blockId, neighbourId)) {
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
): Result.Result<
  MeshLayers,
  ChunkViewFailure | LayerLookupFailureWithTable | FluidLookupFailure | FluidViewFailure | CrossPlantLookupFailure | SpecialMeshFailure
> =>
  Result.flatMap(validateChunkViews(chunk, neighbours), () =>
    Result.flatMap(SPECIAL_BLOCK_LOOKUP, (specialLookup) =>
      Result.flatMap(layerLookupForMesh(config), (lookup) =>
        Result.flatMap(fluidLookupForMesh(config), (fluids) => {
          return Result.flatMap(crossPlantLookupForMesh(config), (plants) =>
            Result.flatMap(
              meshSpecialBlocks(
                specialLookup,
                chunk,
                neighbours,
                chunk.height,
                fullSpecialRegion(chunk.height),
                config,
              ),
              (specialBlocks) =>
              Result.map(
                meshFluidSurfaces(chunk, neighbours, fluids, lookup.table, plants, chunk.height),
                (fluidQuads) => {
                  const { layers, push } = makeSink(
                    lookup,
                    meshCrossPlants({ chunk, neighbours, plantLookup: plants, yLimit: chunk.height }),
                    fluidQuads,
                    specialBlocks,
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
                      specialLookup,
                      push,
                    })
                  }

                  return layers
                },
              ),
            ),
          )
        }),
      ),
    ),
  )

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

/**
 * Mesh only dirty cells while consulting the complete chunk and its neighbours
 * for visibility, AO, and fluid corner data. The input halo influences those
 * reads; it never owns or contributes output cells.
 */
export const meshChunkRegion = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  dirtyRegion: MeshRegion,
): Result.Result<
  RegionMesh,
  ChunkViewFailure | LayerLookupFailureWithTable | FluidLookupFailure | FluidViewFailure | CrossPlantLookupFailure | SpecialMeshFailure | GreedyMaskFailure
> =>
  Result.flatMap(validateChunkViews(chunk, neighbours), () => {
    const dirty = normalizeRegion(dirtyRegion, chunk.height)
    const [, maxY] = dirty.max

    return Result.flatMap(SPECIAL_BLOCK_LOOKUP, (specialLookup) =>
      Result.flatMap(layerLookupForMesh(config), (lookup) =>
        Result.flatMap(fluidLookupForMesh(config), (fluids) => {
          return Result.flatMap(crossPlantLookupForMesh(config), (plants) => {
            if (isEmptyRegion(dirty)) {
              return Result.map(validateFluidViews(chunk, neighbours), () => ({
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
              }))
            }

            return Result.flatMap(meshSpecialBlocks(specialLookup, chunk, neighbours, maxY, dirty, config), (specialBlocks) =>
              Result.flatMap(
                meshFluidSurfaces(chunk, neighbours, fluids, lookup.table, plants, maxY, dirty),
                (fluidQuads) => {
                  const { layers, push } = makeSink(
                    lookup,
                    meshCrossPlants({ bounds: dirty, chunk, neighbours, plantLookup: plants, yLimit: maxY }),
                    fluidQuads,
                    specialBlocks,
                  )
                  const required = CHUNK_SIZE * Math.max(maxY, CHUNK_SIZE)
                  const light = lightMasksOf(chunk, required)
                  const mask = new Uint32Array(required)
                  return Result.map(meshAllFaces({
                    chunk,
                    fluids,
                    light,
                    lookup,
                    mask,
                    neighbours,
                    plants,
                    region: dirty,
                    specialLookup,
                    push,
                    yLimit: maxY,
                  }), () => ({
                    dirtyRegion: dirty,
                    layers,
                    ownedRegion: dirty,
                  }))
                },
              ),
            )
          })
        }),
      ),
    )
  })
