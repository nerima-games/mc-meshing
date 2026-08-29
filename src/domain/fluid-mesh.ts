/**
 * Public fluid-meshing façade.
 *
 * Fluid state decoding and surface geometry are separate modules so that the
 * simulation-facing calculations and renderer-facing vertex construction can
 * evolve independently. This module keeps the stable public API in one place.
 */
import { CHUNK_SIZE, type ChunkNeighbours, type ChunkView } from './chunk-view.js'
import { SOURCE_SURFACE_HEIGHT, buildFluidLookup, isFluidBlock } from './fluid-state.js'
import { hasFluidGeometry, meshFluidCellsInBounds } from './fluid-geometry.js'
import type { FluidFlow, FluidQuad, FluidVertex } from './geometry-types.js'

export { buildFluidLookup, isFluidBlock, SOURCE_SURFACE_HEIGHT }
export type { FluidFlow, FluidQuad, FluidVertex }

export type FluidBounds = {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

export type FluidMeshInput = {
  readonly chunk: ChunkView
  readonly neighbours: ChunkNeighbours
  readonly fluids: Uint8Array
  readonly layers: Uint8Array
  readonly plants: Uint8Array
  readonly yLimit: number
  readonly bounds?: FluidBounds
}

const ZERO_INDEX = 0
const NO_FLUID_QUADS: ReadonlyArray<FluidQuad> = Object.freeze([])
const defaultBoundsFor = (yLimit: number): FluidBounds => ({
  max: [CHUNK_SIZE, yLimit, CHUNK_SIZE],
  min: [ZERO_INDEX, ZERO_INDEX, ZERO_INDEX],
})

export const meshFluidSurfaces = ({
  bounds,
  chunk,
  fluids,
  layers,
  neighbours,
  plants,
  yLimit,
}: FluidMeshInput): ReadonlyArray<FluidQuad> => {
  if (!hasFluidGeometry(fluids)) {
    return NO_FLUID_QUADS
  }
  return meshFluidCellsInBounds(
    chunk,
    neighbours,
    fluids,
    layers,
    plants,
    yLimit,
    bounds ?? defaultBoundsFor(yLimit),
  )
}
