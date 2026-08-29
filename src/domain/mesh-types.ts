import { MESH_LAYERS, type MeshLayer } from './opacity.js'
import type { CrossPlantQuad, FluidQuad, MeshQuad } from './geometry-types.js'
import type { SpecialQuad } from './special-mesh.js'

export type { MeshQuad } from './geometry-types.js'
export type Quad = MeshQuad

/** The three cube layers plus dedicated non-cube geometry lists. */
export type MeshLayers = {
  readonly [K in MeshLayer]: ReadonlyArray<MeshQuad>
} & {
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly fluids: ReadonlyArray<FluidQuad>
  readonly specials: ReadonlyArray<SpecialQuad>
}

/** Chunk-local, half-open integer bounds: min is inclusive and max is exclusive. */
export type MeshRegion = {
  readonly min: readonly [lx: number, y: number, lz: number]
  readonly max: readonly [lx: number, y: number, lz: number]
}

/** Independently owned geometry for one replaceable chunk subregion. */
export type RegionMesh = {
  readonly dirtyRegion: MeshRegion
  readonly ownedRegion: MeshRegion
  readonly layers: MeshLayers
}

/** Number of block-face quads; dedicated geometry is intentionally excluded. */
export const totalQuadCount = (layers: MeshLayers): number =>
  layers.opaque.length + layers.water.length + layers.transparentSolid.length

/** Total block-face area covered by all cube-layer quads. */
export const totalQuadArea = (layers: MeshLayers): number => {
  let area = 0
  for (const layer of MESH_LAYERS) {
    for (const quad of layers[layer]) {
      area += quad.width * quad.height
    }
  }
  return area
}
