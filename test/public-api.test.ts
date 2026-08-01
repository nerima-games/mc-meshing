/**
 * The barrel is what mc-render imports. A re-export dropped here is invisible
 * to every other test in this repository and breaks the renderer, so it is
 * pinned explicitly.
 *
 * This file also carries the two structural assertions that plan.md §5.2 makes
 * non-negotiable: the transparency sets are native, and the layer priority is
 * the documented one.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as meshing from '../src/index'

describe('public API surface', () => {
  it.effect('re-exports every value mc-render is expected to import', () =>
    Effect.sync(() => {
      const expected = [
        // chunk-view
        'AIR',
        'CHUNK_SIZE',
        'CHUNK_HEIGHT',
        'BLOCKS_PER_CHUNK',
        'blockIndex',
        'emptyChunk',
        'getBlock',
        'getBlockAcrossBoundary',
        // faces
        'FACES',
        'FACE_DIRECTIONS',
        'VERTICES_PER_QUAD',
        'INDICES_PER_QUAD',
        'oppositeDirection',
        'faceOf',
        'tangentAxes',
        // lod — mc-render decides WHICH level a chunk is at and imports the
        // vocabulary for it from here; see docs/responsibility.md §3.4.
        'LOD_LEVELS',
        'LodLevelSchema',
        'packQuadKey',
        'simplifyMesh',
        // opacity
        'MESH_LAYERS',
        'MESH_LAYER_PRIORITY',
        'MAX_BLOCK_ID',
        'EMPTY_MESH_CONFIG',
        'layerOfBlockId',
        'buildLayerLookup',
        'occludes',
        // mesh
        'meshChunk',
        'totalQuadCount',
        // Added with the greedy merge. `totalQuadArea` is the quantity merging
        // must NOT change, and mc-render wants it for the same reason this
        // repository's tests do — a quad count stopped being a face count the
        // day quads stopped being 1x1. `meshChunkNaive` is the oracle the merge
        // is checked against; see domain/mesh.ts on why it is public rather
        // than copied into test/.
        'totalQuadArea',
        'meshChunkNaive',
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
      // structural equality through Equal/Hash dispatch, which is orders of
      // magnitude slower per lookup. This is measured, not preferred.
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
      // nothing finer than that is ever needed.
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
        waterBlockIds: new Set([2]),
        transparentSolidBlockIds: new Set([3, 255]),
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
      // a glass box would not render — the classic "world is inside out" bug.
      const config = {
        waterBlockIds: new Set([2]),
        transparentSolidBlockIds: new Set([3]),
      }
      const lookup = meshing.buildLayerLookup(config)
      expect(meshing.occludes(lookup, meshing.AIR)).toBe(false)
      expect(meshing.occludes(lookup, 1)).toBe(true)
      expect(meshing.occludes(lookup, 2)).toBe(false)
      expect(meshing.occludes(lookup, 3)).toBe(false)
    }),
  )
})
