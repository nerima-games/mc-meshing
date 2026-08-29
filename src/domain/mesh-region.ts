import { CHUNK_SIZE, type ChunkNeighbours, type ChunkView } from './chunk-view.js'
import {
  FIRST_INDEX,
  type FaceScanContext,
  STEP,
  emitUnitFace,
  isFaceExposed,
  makeSink,
  meshCrossPlants,
  meshFluidSurfaces,
  meshLookupsFor,
  meshSpecialBlocks,
} from './mesh-common.js'
import type { MeshRegion, Quad, RegionMesh } from './mesh-types.js'
import { FACES } from './faces.js'
import type { MeshConfig } from './opacity.js'
import type { SpecialBounds } from './special-mesh.js'

const clampInteger = (value: number, lower: number, upper: number): number => {
  let finiteValue = value
  if (!Number.isFinite(value)) {
    finiteValue = lower
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

const HALO_CELLS = 1

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

const specialBoundsOf = (region: MeshRegion): SpecialBounds => {
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = [region.min, region.max]
  return { maxX, maxY, maxZ, minX, minY, minZ }
}

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

const meshAllRegionFaces = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  lookup: Uint8Array,
  plants: Uint8Array,
  fluids: Uint8Array,
  specials: Uint8Array,
  owned: MeshRegion,
  push: (quad: Quad) => void,
): void => {
  for (const face of FACES) {
    scanRegionFace({ chunk, face, fluids, lookup, neighbours, plants, push, specials }, owned)
  }
}

const emptyRegionMesh = (dirtyRegion: MeshRegion): RegionMesh => ({
  dirtyRegion,
  layers: {
    crossPlants: [],
    fluids: [],
    opaque: [],
    specials: [],
    transparentSolid: [],
    water: [],
  },
  ownedRegion: dirtyRegion,
})

const meshNonEmptyRegion = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  dirty: MeshRegion,
): RegionMesh => {
  const owned = haloRegion(dirty, chunk.height)
  const [, maxY] = owned.max
  const { lookup, plants, fluids, specials } = meshLookupsFor(config)
  const isVisible = (blockId: number, neighbourId: number): boolean =>
    isFaceExposed(lookup, plants, specials, blockId, neighbourId)
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants(chunk, plants, maxY, owned),
    meshFluidSurfaces({ bounds: owned, chunk, fluids, layers: lookup, neighbours, plants, yLimit: maxY }),
    meshSpecialBlocks({
      bounds: specialBoundsOf(owned),
      chunk,
      isFaceVisible: isVisible,
      lookup: specials,
      neighbours,
      yLimit: maxY,
    }),
  )

  meshAllRegionFaces(chunk, neighbours, lookup, plants, fluids, specials, owned, push)

  return {
    dirtyRegion: dirty,
    layers,
    ownedRegion: owned,
  }
}

/** Remesh the geometry affected by a chunk-local half-open dirty region. */
export const meshChunkRegion = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  dirtyRegion: MeshRegion,
): RegionMesh => {
  const dirty = normalizeRegion(dirtyRegion, chunk.height)
  const empty = dirty.min.some((value, axis) => value >= dirty.max[axis]!)
  if (empty) {
    return emptyRegionMesh(dirty)
  }
  return meshNonEmptyRegion(chunk, neighbours, config, dirty)
}
