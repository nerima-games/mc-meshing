import { MESH_LAYERS, type MeshLayer } from './opacity.js'
import type { BlockId } from './block-data.js'
import type { CrossPlantQuad } from './plant-types.js'
import type { FacePlacement } from './faces.js'
import type { FluidQuad } from './fluid-types.js'
import type { QuadLight } from './light-types.js'
import type { SpecialBlockQuad } from './special-types.js'

type CubeQuadGeometry = {
  readonly blockId: BlockId
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly width: number
  readonly height: number
  readonly ao: number
  readonly light?: QuadLight
}

/** One emitted cube-face quad. Positions are chunk-local; mc-render applies the chunk offset. */
export type Quad = CubeQuadGeometry & FacePlacement

export type MeshLayers = {
  readonly [K in MeshLayer]: ReadonlyArray<Quad>
} & {
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly fluids: ReadonlyArray<FluidQuad>
  readonly specialBlocks: ReadonlyArray<SpecialBlockQuad>
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

/** Total quads across the three greedy cube-face layers. */
export const totalQuadCount = (layers: MeshLayers): number =>
  layers.opaque.length + layers.water.length + layers.transparentSolid.length

/** Total block-face area covered by all greedy cube-face quads. */
export const totalQuadArea = (layers: MeshLayers): number => {
  let area = 0
  for (const layer of MESH_LAYERS) {
    for (const quad of layers[layer]) {
      area += quad.width * quad.height
    }
  }
  return area
}
