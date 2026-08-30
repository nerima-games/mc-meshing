/**
 * The barrel is what mc-render imports. A re-export dropped here is invisible
 * to every other test in this repository and breaks the renderer, so it is
 * pinned explicitly.
 *
 * This file also carries the two structural assertions that plan.md §5.2 makes
 * non-negotiable: the transparency sets are native, and the layer priority is
 * the documented one.
 */
import { describe, expect, it } from './effect-test.js'
import { Effect } from 'effect'
import * as meshing from '../src/index'

describe('public API surface', () => {
  it.effect('exports the kernel branded id type for registry-derived values', () =>
    Effect.sync(() => {
      const air: meshing.BlockId = meshing.AIR
      expect(air).toBe(meshing.AIR)
    }),
  )

  it.effect('re-exports every value mc-render is expected to import', () =>
    Effect.sync(() => {
      const expected = [
        // Chunk-view
        'AIR',
        'CHUNK_SIZE',
        'CHUNK_HEIGHT',
        'BLOCKS_PER_CHUNK',
        'blockIndex',
        'emptyChunk',
        'getBlock',
        'getBlockAcrossBoundary',
        // Kernel-derived block data
        'blockIdsWithRenderKind',
        'MINECRAFT_WATER_BLOCK_IDS',
        'MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS',
        'MINECRAFT_CROSS_PLANT_BLOCK_IDS',
        'MINECRAFT_FLUID_MAX_LEVELS',
        // Ambient occlusion
        'AO_LEVELS',
        'AO_MAX',
        'AO_NONE',
        'ambientOcclusionAt',
        // Injected Minecraft light
        'LIGHT_LEVEL_MIN',
        'LIGHT_LEVEL_MAX',
        'clampMeshLight',
        'sampleLightAt',
        'quadLightAt',
        // Faces
        'FACES',
        'FACE_DIRECTIONS',
        'VERTICES_PER_QUAD',
        'INDICES_PER_QUAD',
        'oppositeDirection',
        'faceOf',
        'facePlacementOf',
        'tangentAxes',
        // Lod — mc-render decides WHICH level a chunk is at and imports the
        // Vocabulary for it from here; see docs/responsibility.md §3.4.
        'LOD_LEVELS',
        'LodLevelSchema',
        'packQuadKey',
        'simplifyMesh',
        // Opacity
        'MESH_LAYERS',
        'MESH_LAYER_PRIORITY',
        'MAX_BLOCK_ID',
        'EMPTY_MESH_CONFIG',
        'MINECRAFT_MESH_CONFIG',
        'layerOfBlockId',
        'buildLayerLookup',
        'occludes',
        // Plant, fluid, and kernel-special geometry
        'PLANT_INSET',
        'buildCrossPlantLookup',
        'isCrossPlant',
        'meshCrossPlants',
        'SOURCE_SURFACE_HEIGHT',
        'buildFluidLookup',
        'isFluidBlock',
        'meshFluidSurfaces',
        'isSpecialBlock',
        'meshSpecialBlocks',
        // Mesh
        'meshChunk',
        'MeshScratch',
        'createMeshScratch',
        'totalQuadCount',
        // Added with the greedy merge. `totalQuadArea` is the quantity merging
        // Must NOT change, and mc-render wants it for the same reason this
        // Repository's tests do — a quad count stopped being a face count the
        // Day quads stopped being 1x1. `meshChunkNaive` is the oracle the merge
        // Is checked against; see domain/mesh.ts on why it is public rather
        // Than copied into test/.
        'totalQuadArea',
        'meshChunkNaive',
        'meshChunkRegion',
        // Packed GPU-ready geometry
        'MESH_BUFFER_LAYERS',
        'packMeshLayers',
        // Resource-pack JSON resolution and pure model meshing
        'normalizeResourceName',
        'resolveBlockStateModels',
        'resolveBlockModel',
        'resolveModelTexture',
        'ResourcePackAssetsSchema',
        'ResourcePackParseError',
        'parseResourcePackAssets',
        'parseResourcePackAssetsJson',
        'meshBlockModel',
        'meshBlockState',
      ]
      const actual = new Set(Object.keys(meshing))
      for (const name of expected) {
        expect(actual.has(name)).toBe(true)
      }
    }),
  )
})

describe('the structural guarantees plan.md §5.2 makes non-negotiable', () => {
  it.effect('the transparency sets are NATIVE Set, never Effect HashSet', () =>
    Effect.sync(() => {
      // ~400k membership tests per chunk. Effect's HashSet compares by
      // Structural equality through Equal/Hash dispatch, which is orders of
      // Magnitude slower per lookup. This is measured, not preferred.
      expect(meshing.EMPTY_MESH_CONFIG.waterBlockIds).toBeInstanceOf(Set)
      expect(meshing.EMPTY_MESH_CONFIG.transparentSolidBlockIds).toBeInstanceOf(Set)
    }),
  )

  it.effect('the layer priority is transparentSolid > water > opaque, in that order', () =>
    Effect.sync(() => {
      expect(meshing.MESH_LAYER_PRIORITY).toStrictEqual(['transparentSolid', 'water', 'opaque'])
    }),
  )

  it.effect('the canonical face order is +X -X +Y -Y +Z -Z, which every golden hash depends on', () =>
    Effect.sync(() => {
      expect(meshing.FACE_DIRECTIONS).toStrictEqual(['xPos', 'xNeg', 'yPos', 'yNeg', 'zPos', 'zNeg'])
      expect(meshing.FACES.map((face) => [face.nx, face.ny, face.nz])).toStrictEqual([
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ])
      // A grass block needs different textures on top, sides and bottom, and
      // Nothing finer than that is ever needed.
      expect(meshing.FACES.map((face) => face.role)).toStrictEqual([
        'side',
        'side',
        'top',
        'bottom',
        'side',
        'side',
      ])
    }),
  )

  it.effect('every face has an opposite, and taking it twice is the identity', () =>
    Effect.sync(() => {
      for (const direction of meshing.FACE_DIRECTIONS) {
        expect(meshing.oppositeDirection(meshing.oppositeDirection(direction))).toBe(direction)
        expect(meshing.oppositeDirection(direction)).not.toBe(direction)
      }
    }),
  )

  it.effect('the layer lookup table covers every representable block id', () =>
    Effect.sync(() => {
      const config = {
        crossPlantBlockIds: new Set<number>(),
        fluidMaxLevels: new Map<number, number>(),
        transparentSolidBlockIds: new Set([3, 255]),
        waterBlockIds: new Set([2]),
      }
      const lookup = meshing.buildLayerLookup(config)
      expect(lookup.length).toBe(meshing.MAX_BLOCK_ID + 1)
      for (let blockId = 0; blockId <= meshing.MAX_BLOCK_ID; blockId += 1) {
        expect(meshing.MESH_LAYERS[lookup[blockId] ?? -1]).toBe(meshing.layerOfBlockId(config, blockId))
      }
    }),
  )

  it.effect('only fully opaque non-air blocks occlude their neighbours', () =>
    Effect.sync(() => {
      // If water or glass occluded, the underside of a lake and the far pane of
      // A glass box would not render — the classic "world is inside out" bug.
      const config = {
        crossPlantBlockIds: new Set<number>(),
        fluidMaxLevels: new Map<number, number>(),
        transparentSolidBlockIds: new Set([3]),
        waterBlockIds: new Set([2]),
      }
      const lookup = meshing.buildLayerLookup(config)
      expect(meshing.occludes(lookup, meshing.AIR)).toBe(false)
      expect(meshing.occludes(lookup, 1)).toBe(true)
      expect(meshing.occludes(lookup, 2)).toBe(false)
      expect(meshing.occludes(lookup, 3)).toBe(false)
    }),
  )
})
