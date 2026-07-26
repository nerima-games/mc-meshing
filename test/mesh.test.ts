/**
 * Face-count and face-order properties.
 *
 * These are the invariants that the greedy merge — which is not written yet —
 * will have to preserve. Writing them now means the merge lands against a
 * standing oracle rather than against nothing.
 *
 * Regression names (docs/design-notes.md):
 *   meshing-isolated-block-has-six-faces
 *   meshing-shared-faces-are-culled
 *   meshing-face-order-is-canonical
 *   meshing-face-count-upper-bound
 *   meshing-boundary-open-when-neighbour-absent
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  AIR,
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  blockIndex,
  emptyChunk,
  getBlock,
  type ChunkView,
} from '../domain/chunk-view'
import { FACES, FACE_DIRECTIONS } from '../domain/faces'
import { meshChunk, totalQuadCount, type Quad } from '../domain/mesh'
import { EMPTY_MESH_CONFIG, type MeshConfig } from '../domain/opacity'

const STONE = 1
const WATER = 2
const GLASS = 3

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz)] = blockId
  }
  return { blocks }
}

const CONFIG: MeshConfig = {
  waterBlockIds: new Set([WATER]),
  transparentSolidBlockIds: new Set([GLASS]),
}

describe('face count', () => {
  it.effect('an empty chunk produces no faces at all', () =>
    Effect.sync(() => {
      const layers = meshChunk(emptyChunk(), {}, EMPTY_MESH_CONFIG)
      expect(totalQuadCount(layers)).toBe(0)
    }),
  )

  it.effect('a single block surrounded by air produces exactly six faces, one per direction', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[8, 64, 8, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(layers.opaque.map((quad) => quad.direction).sort()).toStrictEqual([...FACE_DIRECTIONS].sort())
    }),
  )

  it.effect('two adjacent blocks produce ten faces, not twelve: the shared face is culled from both sides', () =>
    Effect.sync(() => {
      // This is THE invariant of face culling. 12 means neither side was
      // culled; 11 means only one was, which is the asymmetry bug that shows up
      // as a one-sided invisible wall.
      for (const face of FACES) {
        const first: readonly [number, number, number, number] = [8, 64, 8, STONE]
        const second: readonly [number, number, number, number] = [
          8 + face.nx,
          64 + face.ny,
          8 + face.nz,
          STONE,
        ]
        const layers = meshChunk(chunkWith([first, second]), {}, EMPTY_MESH_CONFIG)
        expect(totalQuadCount(layers)).toBe(10)
      }
    }),
  )

  it.effect('an N x N flat layer of stone has an exactly predictable face count', () =>
    Effect.sync(() => {
      // A single flat layer of side N: N*N top faces, N*N bottom faces, and
      // 4*N side faces around the rim. Naive meshing hits this exactly; a
      // correct greedy merge must cover the same surface with fewer quads,
      // never with different coverage.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 1, max: CHUNK_SIZE }), (side) => {
          const cells: Array<readonly [number, number, number, number]> = []
          for (let lx = 0; lx < side; lx += 1) {
            for (let lz = 0; lz < side; lz += 1) {
              cells.push([lx, 64, lz, STONE])
            }
          }
          const layers = meshChunk(chunkWith(cells), {}, EMPTY_MESH_CONFIG)
          return totalQuadCount(layers) === 2 * side * side + 4 * side
        }),
        { numRuns: 16 },
      )
    }),
  )

  it.effect('face count never exceeds six per non-air cell, whatever the arrangement', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.array(
            FastCheck.tuple(
              FastCheck.integer({ min: 0, max: CHUNK_SIZE - 1 }),
              FastCheck.integer({ min: 0, max: CHUNK_HEIGHT - 1 }),
              FastCheck.integer({ min: 0, max: CHUNK_SIZE - 1 }),
              FastCheck.constantFrom(STONE, WATER, GLASS),
            ),
            { minLength: 0, maxLength: 40 },
          ),
          (cells) => {
            const chunk = chunkWith(cells.map(([lx, y, lz, id]) => [lx, y, lz, id] as const))
            const layers = meshChunk(chunk, {}, CONFIG)
            let solidCells = 0
            for (let index = 0; index < BLOCKS_PER_CHUNK; index += 1) {
              if ((chunk.blocks[index] ?? AIR) !== AIR) {
                solidCells += 1
              }
            }
            return totalQuadCount(layers) <= solidCells * FACES.length
          },
        ),
        { numRuns: 100 },
      )
    }),
  )
})

describe('face ordering', () => {
  it.effect('emits faces grouped by direction, in the canonical +X -X +Y -Y +Z -Z order', () =>
    Effect.sync(() => {
      // Golden hashes over geometry buffers are only stable if this order is.
      // See docs/design-notes.md.
      const cells: Array<readonly [number, number, number, number]> = []
      for (let lx = 0; lx < 4; lx += 1) {
        for (let lz = 0; lz < 4; lz += 1) {
          cells.push([lx, 64, lz, STONE])
        }
      }
      const layers = meshChunk(chunkWith(cells), {}, EMPTY_MESH_CONFIG)
      const seen: Array<string> = []
      for (const quad of layers.opaque) {
        if (seen[seen.length - 1] !== quad.direction) {
          seen.push(quad.direction)
        }
      }
      expect(seen).toStrictEqual([...FACE_DIRECTIONS])
    }),
  )

  it.effect('is deterministic: meshing the same chunk twice produces identical quad sequences', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [3, 60, 3, STONE],
        [3, 61, 3, WATER],
        [4, 60, 3, GLASS],
      ])
      const render = (quads: ReadonlyArray<Quad>): string =>
        quads.map((quad) => `${quad.direction}:${quad.lx},${quad.y},${quad.lz}:${quad.blockId}`).join('|')
      const first = meshChunk(chunk, {}, CONFIG)
      const second = meshChunk(chunk, {}, CONFIG)
      expect(render(first.opaque)).toBe(render(second.opaque))
      expect(render(first.water)).toBe(render(second.water))
      expect(render(first.transparentSolid)).toBe(render(second.transparentSolid))
    }),
  )
})

describe('layer routing', () => {
  it.effect('routes water to the water layer and glass to the transparentSolid layer, not to opaque', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [1, 64, 1, STONE],
          [3, 64, 3, WATER],
          [5, 64, 5, GLASS],
        ]),
        {},
        CONFIG,
      )
      expect(layers.opaque.every((quad) => quad.blockId === STONE)).toBe(true)
      expect(layers.water.every((quad) => quad.blockId === WATER)).toBe(true)
      expect(layers.transparentSolid.every((quad) => quad.blockId === GLASS)).toBe(true)
      expect(layers.opaque.length).toBe(6)
      expect(layers.water.length).toBe(6)
      expect(layers.transparentSolid.length).toBe(6)
    }),
  )

  it.effect('with an empty config every block is opaque — the sets really are the only source of truth', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[3, 64, 3, WATER]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(layers.water.length).toBe(0)
    }),
  )

  it.effect('transparentSolid beats water when a block id is claimed by both sets', () =>
    Effect.sync(() => {
      // plan.md §3.3 fixes this priority. Making the classification total means
      // a config mistake degrades an appearance instead of crashing a worker.
      const contested: MeshConfig = {
        waterBlockIds: new Set([WATER]),
        transparentSolidBlockIds: new Set([WATER]),
      }
      const layers = meshChunk(chunkWith([[3, 64, 3, WATER]]), {}, contested)
      expect(layers.transparentSolid.length).toBe(6)
      expect(layers.water.length).toBe(0)
    }),
  )

  it.effect('a solid block behind glass still renders: transparent solids do not occlude', () =>
    Effect.sync(() => {
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, STONE],
          [9, 64, 8, GLASS],
        ]),
        {},
        CONFIG,
      )
      // The stone keeps all six faces: glass does not occlude, so you can see
      // the stone through it. That is the whole point of the three-valued model.
      expect(layers.opaque.length).toBe(6)
      // The glass loses exactly one: its inward face is pressed against opaque
      // stone and can never be seen. Occlusion is asymmetric here, and correctly
      // so — the culling rule is about the NEIGHBOUR's opacity, not the
      // emitter's. If this ever reads 6, transparent solids have started
      // treating opaque neighbours as see-through.
      expect(layers.transparentSolid.length).toBe(5)
      expect(layers.transparentSolid.some((quad) => quad.direction === 'xNeg')).toBe(false)
    }),
  )

  it.effect('two adjacent water cells have no surface between them', () =>
    Effect.sync(() => {
      // Without the same-layer cull the interior of a lake is a wall of quads.
      const layers = meshChunk(
        chunkWith([
          [8, 64, 8, WATER],
          [9, 64, 8, WATER],
        ]),
        {},
        CONFIG,
      )
      expect(layers.water.length).toBe(10)
    }),
  )
})

describe('chunk boundaries', () => {
  it.effect('an absent neighbour reads as air, so the chunk meshes as open rather than as a black wall', () =>
    Effect.sync(() => {
      const layers = meshChunk(chunkWith([[0, 64, 0, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
    }),
  )

  it.effect('a present neighbour occludes across the boundary, so seams do not double up', () =>
    Effect.sync(() => {
      const neighbourBlocks = new Uint8Array(BLOCKS_PER_CHUNK)
      neighbourBlocks[blockIndex(CHUNK_SIZE - 1, 64, 0)] = STONE
      const layers = meshChunk(
        chunkWith([[0, 64, 0, STONE]]),
        { xNeg: { blocks: neighbourBlocks } },
        EMPTY_MESH_CONFIG,
      )
      expect(layers.opaque.length).toBe(5)
      expect(layers.opaque.some((quad) => quad.direction === 'xNeg')).toBe(false)
    }),
  )
})

describe('getBlock', () => {
  it.effect('returns AIR for every out-of-range coordinate instead of throwing or returning undefined', () =>
    Effect.sync(() => {
      const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
      blocks[blockIndex(0, 0, 0)] = STONE
      for (const [lx, y, lz] of [
        [-1, 0, 0],
        [CHUNK_SIZE, 0, 0],
        [0, -1, 0],
        [0, CHUNK_HEIGHT, 0],
        [0, 0, -1],
        [0, 0, CHUNK_SIZE],
      ] as const) {
        expect(getBlock(blocks, lx, y, lz)).toBe(AIR)
      }
      expect(getBlock(blocks, 0, 0, 0)).toBe(STONE)
    }),
  )

  it.effect('agrees with blockIndex over the whole chunk, so the storage layout is the documented one', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 0, max: CHUNK_SIZE - 1 }),
          FastCheck.integer({ min: 0, max: CHUNK_HEIGHT - 1 }),
          FastCheck.integer({ min: 0, max: CHUNK_SIZE - 1 }),
          (lx, y, lz) => {
            const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
            blocks[blockIndex(lx, y, lz)] = STONE
            return getBlock(blocks, lx, y, lz) === STONE
          },
        ),
        { numRuns: 200 },
      )
    }),
  )
})
