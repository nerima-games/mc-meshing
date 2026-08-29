import {
  AIR,
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  getBlock,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { BLOCK_ID_MAX, MESH_LAYERS, type MeshConfig, buildLayerLookup } from './opacity.js'
import {
  type CrossPlantQuad,
  buildCrossPlantLookup,
  isCrossPlant,
  meshCrossPlants,
} from './plant-mesh.js'
import { type FluidQuad, buildFluidLookup, isFluidBlock, meshFluidSurfaces } from './fluid-mesh.js'
import type { MeshLayers, Quad } from './mesh-types.js'
import {
  type SpecialQuad,
  buildSpecialLookup,
  isSpecialBlock,
  meshSpecialBlocks,
} from './special-mesh.js'
import { type Face } from './faces.js'
import { ambientOcclusionAt } from './ambient-occlusion.js'

export const FIRST_INDEX = 0
export const STEP = 1
export const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')

const BLOCK_ID_TABLE_SIZE = BLOCK_ID_MAX + STEP
const LAYER_LOOKUP_CACHE = new WeakMap<object, WeakMap<object, Uint8Array>>()

export const layerLookupForMesh = (config: MeshConfig): Uint8Array => {
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

const CROSS_PLANT_LOOKUP_CACHE = new WeakMap<object, Uint8Array>()
const EMPTY_CROSS_PLANT_LOOKUP = new Uint8Array(BLOCK_ID_TABLE_SIZE)

export const crossPlantLookupForMesh = (config: MeshConfig): Uint8Array => {
  const blockIds = config.crossPlantBlockIds
  if (!blockIds) {
    return EMPTY_CROSS_PLANT_LOOKUP
  }
  const cached = CROSS_PLANT_LOOKUP_CACHE.get(blockIds)
  if (cached) {
    return cached
  }
  const lookup = buildCrossPlantLookup(config)
  CROSS_PLANT_LOOKUP_CACHE.set(blockIds, lookup)
  return lookup
}

const FLUID_LOOKUP_CACHE = new WeakMap<object, Uint8Array>()
const EMPTY_FLUID_LOOKUP = new Uint8Array(BLOCK_ID_TABLE_SIZE)

export const fluidLookupForMesh = (config: MeshConfig): Uint8Array => {
  const maxLevels = config.fluidMaxLevels
  if (!maxLevels) {
    return EMPTY_FLUID_LOOKUP
  }
  const cached = FLUID_LOOKUP_CACHE.get(maxLevels)
  if (cached) {
    return cached
  }
  const lookup = buildFluidLookup(config)
  FLUID_LOOKUP_CACHE.set(maxLevels, lookup)
  return lookup
}

const SPECIAL_LOOKUP_CACHE = new WeakMap<object, WeakMap<object, Uint8Array>>()
const EMPTY_SPECIAL_LOOKUP = new Uint8Array(BLOCK_ID_TABLE_SIZE)
const EMPTY_SPECIAL_RENDER_KINDS = new Map<number, never>()
const EMPTY_SPECIAL_COLLISION_SHAPES = new Map<number, never>()
const EMPTY_TABLE_SIZE = 0

const specialLookupCacheFor = (renderKinds: object): WeakMap<object, Uint8Array> => {
  let byCollisionShape = SPECIAL_LOOKUP_CACHE.get(renderKinds)
  if (!byCollisionShape) {
    byCollisionShape = new WeakMap<object, Uint8Array>()
    SPECIAL_LOOKUP_CACHE.set(renderKinds, byCollisionShape)
  }
  return byCollisionShape
}

const specialLookupForTables = (
  config: MeshConfig,
  renderKinds: object,
  collisionShapes: object,
): Uint8Array => {
  const byCollisionShape = specialLookupCacheFor(renderKinds)
  const cached = byCollisionShape.get(collisionShapes)
  if (cached) {
    return cached
  }
  const lookup = buildSpecialLookup(config)
  byCollisionShape.set(collisionShapes, lookup)
  return lookup
}

export const specialLookupForMesh = (config: MeshConfig): Uint8Array => {
  const renderKinds = config.renderKindByBlockId ?? EMPTY_SPECIAL_RENDER_KINDS
  const collisionShapes = config.collisionShapeByBlockId ?? EMPTY_SPECIAL_COLLISION_SHAPES
  if (renderKinds.size === EMPTY_TABLE_SIZE && collisionShapes.size === EMPTY_TABLE_SIZE) {
    return EMPTY_SPECIAL_LOOKUP
  }
  return specialLookupForTables(config, renderKinds, collisionShapes)
}

export type MeshLookups = {
  readonly fluids: Uint8Array
  readonly lookup: Uint8Array
  readonly plants: Uint8Array
  readonly specials: Uint8Array
}

export const meshLookupsFor = (config: MeshConfig): MeshLookups => ({
  fluids: fluidLookupForMesh(config),
  lookup: layerLookupForMesh(config),
  plants: crossPlantLookupForMesh(config),
  specials: specialLookupForMesh(config),
})

export const layerAt = (lookup: Uint8Array, blockId: number): number => lookup[blockId]!

export const isFaceExposed = (
  lookup: Uint8Array,
  plants: Uint8Array,
  specials: Uint8Array,
  blockId: number,
  neighbourId: number,
): boolean => {
  if (neighbourId === AIR || isCrossPlant(plants, neighbourId) || isSpecialBlock(specials, neighbourId)) {
    return true
  }
  const neighbourLayer = layerAt(lookup, neighbourId)
  return neighbourLayer !== OPAQUE_LAYER && neighbourLayer !== layerAt(lookup, blockId)
}

export const solidCeiling = (chunk: ChunkView): number => {
  const { blocks, height } = chunk
  let highest = -1
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const columnBase = lz * height + lx * height * CHUNK_SIZE
      for (let y = height - STEP; y > highest; y -= STEP) {
        if (blocks.get(columnBase + y) !== AIR) {
          highest = y
          break
        }
      }
    }
  }
  return highest + STEP
}

export type PaintabilityContext = Pick<MeshLookups, 'fluids' | 'plants' | 'specials'>

export const isPaintableCell = (ctx: PaintabilityContext, blockId: number): boolean =>
  blockId !== AIR &&
  !isCrossPlant(ctx.plants, blockId) &&
  !isFluidBlock(ctx.fluids, blockId) &&
  !isSpecialBlock(ctx.specials, blockId)

export const makeSink = (
  lookup: Uint8Array,
  crossPlants: ReadonlyArray<CrossPlantQuad>,
  fluids: ReadonlyArray<FluidQuad>,
  specials: ReadonlyArray<SpecialQuad>,
): {
  readonly layers: MeshLayers
  readonly push: (quad: Quad) => void
} => {
  const opaque: Array<Quad> = []
  const water: Array<Quad> = []
  const transparentSolid: Array<Quad> = []
  const buckets = [opaque, water, transparentSolid]
  return {
    layers: { crossPlants, fluids, opaque, specials, transparentSolid, water },
    push: (quad: Quad): void => {
      const bucket = buckets[layerAt(lookup, quad.blockId)]!
      bucket.push(quad)
    },
  }
}

export type FaceScanContext = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly lookup: Uint8Array
  readonly plants: Uint8Array
  readonly fluids: Uint8Array
  readonly specials: Uint8Array
  readonly face: Face
  readonly push: (quad: Quad) => void
}

export const emitUnitFace = (ctx: FaceScanContext, lx: number, y: number, lz: number): void => {
  const blockId = getBlock(ctx.chunk, lx, y, lz)
  if (isPaintableCell(ctx, blockId)) {
    const neighbourId = getBlockAcrossBoundary(
      ctx.chunk,
      ctx.neighbours,
      lx + ctx.face.nx,
      y + ctx.face.ny,
      lz + ctx.face.nz,
    )
    if (isFaceExposed(ctx.lookup, ctx.plants, ctx.specials, blockId, neighbourId)) {
      ctx.push({
        ao: ambientOcclusionAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz),
        blockId,
        direction: ctx.face.direction,
        height: 1,
        lx,
        lz,
        role: ctx.face.role,
        width: 1,
        y,
      })
    }
  }
}

export const scanChunkFace = (ctx: FaceScanContext): void => {
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      for (let y = FIRST_INDEX; y < ctx.chunk.height; y += STEP) {
        emitUnitFace(ctx, lx, y, lz)
      }
    }
  }
}

export { meshCrossPlants, meshFluidSurfaces, meshSpecialBlocks }
