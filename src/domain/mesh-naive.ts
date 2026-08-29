import type { ChunkNeighbours, ChunkView } from './chunk-view.js'
import {
  isFaceExposed,
  makeSink,
  meshCrossPlants,
  meshFluidSurfaces,
  meshLookupsFor,
  meshSpecialBlocks,
  scanChunkFace,
} from './mesh-common.js'
import { FACES } from './faces.js'
import { MINECRAFT_MESH_CONFIG } from './kernel-mesh-config.js'
import type { MeshConfig } from './opacity.js'
import type { MeshLayers } from './mesh-types.js'

/**
 * Emit one quad per exposed cube face. This is the reference implementation
 * used by coverage tests for the greedy mesher.
 */
export const meshChunkNaive = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig = MINECRAFT_MESH_CONFIG,
): MeshLayers => {
  const { fluids, lookup, plants, specials } = meshLookupsFor(config)
  const isVisible = (blockId: number, neighbourId: number): boolean =>
    isFaceExposed(lookup, plants, specials, blockId, neighbourId)
  const { layers, push } = makeSink(
    lookup,
    meshCrossPlants(chunk, plants, chunk.height),
    meshFluidSurfaces({ chunk, fluids, layers: lookup, neighbours, plants, yLimit: chunk.height }),
    meshSpecialBlocks({ chunk, isFaceVisible: isVisible, lookup: specials, neighbours, yLimit: chunk.height }),
  )

  for (const face of FACES) {
    scanChunkFace({ chunk, face, fluids, lookup, neighbours, plants, push, specials })
  }

  return layers
}
