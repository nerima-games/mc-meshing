/* oxlint-disable new-cap -- Effect Schema exposes capitalized factory functions, not constructors. */
import { Schema } from 'effect'
import type { EffectiveBlockStateValues } from '@nerima-games/mc-kernel'
import type { BlockId } from './block-data.js'
import type { QuadLight } from './light-types.js'

/** Texture stage selected by the growth state of a crop or sapling. */
export type PlantTextureStage =
  | { readonly blockType: 'sapling'; readonly stage: 0 | 1 }
  | { readonly blockType: 'wheat_crop'; readonly stage: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }
  | { readonly blockType: 'potato_crop'; readonly stage: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }
  | { readonly blockType: 'nether_wart_crop'; readonly stage: 0 | 1 | 2 | 3 }

type PlantTextureStageDecoder = Schema.Schema<PlantTextureStage> & Schema.ConstraintDecoder<PlantTextureStage, never>

export const PlantTextureStageSchema: PlantTextureStageDecoder = Schema.Union([
  Schema.Struct({
    blockType: Schema.Literals(['sapling'] as const),
    stage: Schema.Literals([0, 1] as const),
  }),
  Schema.Struct({
    blockType: Schema.Literals(['wheat_crop'] as const),
    stage: Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const),
  }),
  Schema.Struct({
    blockType: Schema.Literals(['potato_crop'] as const),
    stage: Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const),
  }),
  Schema.Struct({
    blockType: Schema.Literals(['nether_wart_crop'] as const),
    stage: Schema.Literals([0, 1, 2, 3] as const),
  }),
])

/** A chunk-local vertex of a diagonal plant plate. */
export type PlantVertex = readonly [number, number, number]

/** One of the two diagonal panes emitted for a cross-plant block. */
export type CrossPlantQuad = {
  readonly blockId: BlockId
  readonly role: 'side'
  /** Effective kernel state used to select a plant texture or model. */
  readonly blockState?: EffectiveBlockStateValues
  readonly vertices: readonly [PlantVertex, PlantVertex, PlantVertex, PlantVertex]
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly ao: number
  readonly light?: QuadLight
}
