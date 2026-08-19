import type { BlockId } from './block-data.js'
import type { QuadLight } from './light-types.js'

/** A chunk-local vertex of a diagonal plant plate. */
export type PlantVertex = readonly [number, number, number]

/** One of the two diagonal panes emitted for a cross-plant block. */
export type CrossPlantQuad = {
  readonly blockId: BlockId
  readonly role: 'side'
  readonly vertices: readonly [PlantVertex, PlantVertex, PlantVertex, PlantVertex]
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly ao: number
  readonly light?: QuadLight
}
