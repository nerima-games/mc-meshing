import { AIR } from './block-data.js'
import { CHUNK_SIZE } from './chunk-view.js'
import { MESH_LAYERS } from './opacity.js'
import { isCrossPlant } from './plant-mesh.js'
import { isSpecialBlock } from './special-mesh.js'

const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')

export const FIRST_INDEX = 0
export const STEP = 1
export const EMPTY_CHUNK_CEILING = 0

export const layerAt = (lookup: Uint8Array, blockId: number): number => lookup[blockId]!

export const isFaceExposed = (
  lookup: Uint8Array,
  plants: Uint8Array,
  blockId: number,
  neighbourId: number,
): boolean => {
  if (neighbourId === AIR || isCrossPlant(plants, neighbourId) || isSpecialBlock(neighbourId)) {
    return true
  }
  const neighbourLayer = layerAt(lookup, neighbourId)
  return neighbourLayer !== OPAQUE_LAYER && neighbourLayer !== layerAt(lookup, blockId)
}

export const solidCeiling = (blocks: Readonly<Uint8Array>, height: number): number => {
  let highest = -1
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const columnBase = lz * height + lx * height * CHUNK_SIZE
      for (let y = height - STEP; y > highest; y -= STEP) {
        if ((blocks[columnBase + y] ?? AIR) !== AIR) {
          highest = y
          break
        }
      }
    }
  }
  return highest + STEP
}
