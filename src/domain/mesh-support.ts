import { Result } from 'effect'
import { AIR, MAX_BLOCK_ID, type BlockId } from './block-data.js'
import { CHUNK_SIZE } from './chunk-view.js'
import { MESH_LAYERS } from './opacity.js'
import { isCrossPlant } from './plant-mesh.js'
import { isSpecialBlock, type SpecialBlockLookup } from './special-mesh.js'

const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')
const LAYER_LOOKUP_LENGTH = MAX_BLOCK_ID + 1
export const FIRST_INDEX = 0
export const STEP = 1
export const EMPTY_CHUNK_CEILING = 0

type DenseLayerTable = Uint8Array

export type LayerLookup = {
  readonly table: DenseLayerTable
  readonly view: DataView
}

export type LayerLookupTableFailure =
  | { readonly _tag: 'InvalidLayerLookupLength'; readonly actual: number; readonly expected: number }
  | { readonly _tag: 'InvalidLayerLookupEntry'; readonly blockId: number; readonly layer: number | undefined }

/** Validate a complete builder table once before it enters the cell loops. */
export const layerLookupFromTable = (table: Uint8Array): Result.Result<LayerLookup, LayerLookupTableFailure> => {
  if (table.length !== LAYER_LOOKUP_LENGTH) {
    return Result.fail({
      _tag: 'InvalidLayerLookupLength',
      actual: table.length,
      expected: LAYER_LOOKUP_LENGTH,
    })
  }
  for (let blockId = 0; blockId <= MAX_BLOCK_ID; blockId += STEP) {
    const layer = table[blockId]
    if (typeof layer === 'undefined' || layer >= MESH_LAYERS.length) {
      return Result.fail({ _tag: 'InvalidLayerLookupEntry', blockId, layer })
    }
  }
  return Result.succeed({ table, view: new DataView(table.buffer, table.byteOffset, table.byteLength) })
}

export const layerAt = (lookup: LayerLookup, blockId: BlockId): number => lookup.view.getUint8(blockId)

export type FaceExposureContext = {
  readonly lookup: LayerLookup
  readonly plants: Uint8Array
  readonly specialLookup: SpecialBlockLookup
}

export const isFaceExposed = (
  ctx: FaceExposureContext,
  blockId: BlockId,
  neighbourId: BlockId,
): boolean => {
  if (
    neighbourId === AIR ||
    isCrossPlant(ctx.plants, neighbourId) ||
    isSpecialBlock(ctx.specialLookup, neighbourId)
  ) {
    return true
  }
  const neighbourLayer = layerAt(ctx.lookup, neighbourId)
  return neighbourLayer !== OPAQUE_LAYER && neighbourLayer !== layerAt(ctx.lookup, blockId)
}

export const solidCeiling = (blocks: Readonly<Uint16Array>, height: number): number => {
  let highest = -1
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const columnBase = lz * height + lx * height * CHUNK_SIZE
      for (let y = height - STEP; y > highest; y -= STEP) {
        if (blocks[columnBase + y] !== AIR) {
          highest = y
          break
        }
      }
    }
  }
  return highest + STEP
}
