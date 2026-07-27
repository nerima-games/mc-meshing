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
 *   meshing-result-is-owned-not-aliased
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
  getBlockAcrossBoundary,
  type ChunkNeighbours,
  type ChunkView,
} from '../domain/chunk-view'
import { FACES, FACE_DIRECTIONS, type FaceDirection } from '../domain/faces'
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

const positionOf = (quad: Quad): string => `${quad.lx},${quad.y},${quad.lz}`

/**
 * Five isolated blocks whose coordinates are pairwise out of step on all three
 * axes, so that sorting them by (lx, lz, y) gives a DIFFERENT sequence from
 * sorting them by any other ordering of the same three keys. That is what makes
 * them able to detect a transposed loop; a cube of blocks could not.
 *
 * Isolated — no two are face-adjacent — so every one contributes all six faces
 * and each direction group holds exactly five quads.
 */
const SCATTERED: ReadonlyArray<readonly [number, number, number, number]> = [
  [3, 5, 3, STONE],
  [5, 1, 9, STONE],
  [1, 9, 1, STONE],
  [5, 7, 0, STONE],
  [1, 3, 5, STONE],
]

type CellAxis = 'lx' | 'y' | 'lz'

const axisOf = (cell: readonly [number, number, number, number], axis: CellAxis): number =>
  axis === 'lx' ? cell[0] : axis === 'y' ? cell[1] : cell[2]

/** `SCATTERED` as `lx,y,lz` strings, ordered by the three given keys. */
const scatteredSortedBy = (first: CellAxis, second: CellAxis, third: CellAxis): ReadonlyArray<string> =>
  [...SCATTERED]
    .sort(
      (left, right) =>
        axisOf(left, first) - axisOf(right, first) ||
        axisOf(left, second) - axisOf(right, second) ||
        axisOf(left, third) - axisOf(right, third),
    )
    .map(([lx, y, lz]) => `${lx},${y},${lz}`)

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

  it.effect('emits, WITHIN one direction, in lx then lz then y order', () =>
    Effect.sync(() => {
      // The test above pins the order of the six GROUPS. This one pins the
      // order inside a group, which domain/mesh.ts declares load-bearing for
      // the same golden hashes and which nothing else asserted.
      //
      // Transposing two of the three loops is a one-line edit that leaves every
      // other test in this file green: the face count is unchanged, the
      // grouping is unchanged, determinism is unchanged. What changes is the
      // byte sequence of the geometry buffer, so mc-render's golden hashes stop
      // matching for a reason nothing here would explain.
      const layers = meshChunk(chunkWith(SCATTERED), {}, EMPTY_MESH_CONFIG)
      const emitted = (direction: FaceDirection): ReadonlyArray<string> =>
        layers.opaque.filter((quad) => quad.direction === direction).map(positionOf)

      for (const direction of FACE_DIRECTIONS) {
        expect(emitted(direction)).toStrictEqual(scatteredSortedBy('lx', 'lz', 'y'))
      }

      // The fixture has to be able to TELL the declared nesting from its
      // neighbours. Blocks laid out on a regular grid cannot: several loop
      // orders produce the same sequence there, and the assertion above would
      // then be satisfied by the very transposition it is meant to catch.
      expect(scatteredSortedBy('lx', 'lz', 'y')).not.toStrictEqual(scatteredSortedBy('lx', 'y', 'lz'))
      expect(scatteredSortedBy('lx', 'lz', 'y')).not.toStrictEqual(scatteredSortedBy('lz', 'lx', 'y'))
      expect(scatteredSortedBy('lx', 'lz', 'y')).not.toStrictEqual(scatteredSortedBy('y', 'lx', 'lz'))
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

describe('quad extent and role', () => {
  /** Every quad the mesher produced, across all three layers. */
  const allQuads = (layers: ReturnType<typeof meshChunk>): ReadonlyArray<Quad> => [
    ...layers.opaque,
    ...layers.water,
    ...layers.transparentSolid,
  ]

  const MIXED = chunkWith([
    [2, 64, 2, STONE],
    [6, 30, 9, WATER],
    [11, 200, 4, GLASS],
    [0, 0, 0, STONE],
    [CHUNK_SIZE - 1, CHUNK_HEIGHT - 1, CHUNK_SIZE - 1, STONE],
  ])

  it.effect('a naive quad covers exactly one block: width and height are both 1', () =>
    Effect.sync(() => {
      // `width`/`height` are the two fields greedy merging exists to change,
      // and until this test they were the only part of a Quad nothing asserted.
      // That is the worst combination: an invariant that a PLANNED change will
      // break, with no test to make the author of that change state it.
      //
      // When the merge lands, this test is expected to fail — and that failure
      // is the point. It should be replaced by "the merged quads cover the same
      // surface area as the naive ones", not deleted.
      const quads = allQuads(meshChunk(MIXED, {}, CONFIG))
      expect(quads.length).toBeGreaterThan(0)
      expect(quads.every((quad) => quad.width === 1)).toBe(true)
      expect(quads.every((quad) => quad.height === 1)).toBe(true)
      // Stated as a total too: sum of areas is the face count, which is the
      // quantity a greedy merge has to preserve while shrinking `quads.length`.
      const area = quads.reduce((total, quad) => total + quad.width * quad.height, 0)
      expect(area).toBe(quads.length)
    }),
  )

  it.effect('carries the role its direction implies: yPos is top, yNeg is bottom, the rest are sides', () =>
    Effect.sync(() => {
      // `role` picks the texture. A grass block with its top role on the -Y
      // face is grass-side-up underground and dirt on the surface, which is a
      // rendering bug with no crash and no failing count anywhere.
      //
      // The expected pairs are spelled out rather than read back out of FACES,
      // so that an edit to the FACES table cannot make this test agree with it.
      const pairs = new Set(allQuads(meshChunk(MIXED, {}, CONFIG)).map((quad) => `${quad.direction}:${quad.role}`))
      expect([...pairs].sort()).toStrictEqual([
        'xNeg:side',
        'xPos:side',
        'yNeg:bottom',
        'yPos:top',
        'zNeg:side',
        'zPos:side',
      ])
    }),
  )

  it.effect('reports the cell it was emitted for, not the cell across the face', () =>
    Effect.sync(() => {
      // A quad addressed at the NEIGHBOUR's coordinates renders one block away
      // from its block — the whole surface shifted by one in six directions at
      // once, which reads as a mesh that no longer lines up with the world.
      const layers = meshChunk(chunkWith([[7, 100, 4, STONE]]), {}, EMPTY_MESH_CONFIG)
      expect(layers.opaque.length).toBe(6)
      expect(new Set(layers.opaque.map(positionOf))).toStrictEqual(new Set(['7,100,4']))
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

  /**
   * The four horizontal seams, each with the cell in the neighbour that TOUCHES
   * it and a cell in the same neighbour that does not.
   *
   * The tangent coordinate is 5 rather than 0 on purpose. With 0, an index
   * transposed between `lx` and `lz` still lands on a real cell and the test
   * cannot tell the two apart; with 5, a transposition reads an empty column
   * and the occlusion disappears.
   */
  const SEAMS = [
    {
      direction: 'xNeg',
      cell: [0, 64, 5],
      touching: [CHUNK_SIZE - 1, 64, 5],
      elsewhere: [0, 64, 5],
    },
    {
      direction: 'xPos',
      cell: [CHUNK_SIZE - 1, 64, 5],
      touching: [0, 64, 5],
      elsewhere: [CHUNK_SIZE - 1, 64, 5],
    },
    {
      direction: 'zNeg',
      cell: [5, 64, 0],
      touching: [5, 64, CHUNK_SIZE - 1],
      elsewhere: [5, 64, 0],
    },
    {
      direction: 'zPos',
      cell: [5, 64, CHUNK_SIZE - 1],
      touching: [5, 64, 0],
      elsewhere: [5, 64, CHUNK_SIZE - 1],
    },
  ] as const satisfies ReadonlyArray<{
    readonly direction: FaceDirection
    readonly cell: readonly [number, number, number]
    readonly touching: readonly [number, number, number]
    readonly elsewhere: readonly [number, number, number]
  }>

  it.effect('occludes across ALL FOUR horizontal seams, not only xNeg', () =>
    Effect.sync(() => {
      // Until this test the xPos, zPos and zNeg arms of getBlockAcrossBoundary
      // were never executed by the suite at all. A transposed or off-by-one
      // index in any of them produces a seam that renders a wall of duplicate
      // faces between two loaded chunks — visible, expensive, and invisible to
      // every count-based test, because the counts are per chunk and each chunk
      // is individually correct.
      for (const seam of SEAMS) {
        const layers = meshChunk(
          chunkWith([[...seam.cell, STONE]]),
          { [seam.direction]: chunkWith([[...seam.touching, STONE]]) },
          EMPTY_MESH_CONFIG,
        )
        expect(layers.opaque.length).toBe(5)
        expect(layers.opaque.some((quad) => quad.direction === seam.direction)).toBe(false)
      }
    }),
  )

  it.effect('reads the cell that touches the seam, not merely some cell in the neighbour', () =>
    Effect.sync(() => {
      // The companion to the test above, and the one that actually pins the
      // index. Occlusion across a seam is satisfied by reading ANY solid cell
      // in the neighbouring chunk; only its absence here shows that the mesher
      // read the one facing column rather than the far side of the neighbour.
      for (const seam of SEAMS) {
        const layers = meshChunk(
          chunkWith([[...seam.cell, STONE]]),
          { [seam.direction]: chunkWith([[...seam.elsewhere, STONE]]) },
          EMPTY_MESH_CONFIG,
        )
        expect(layers.opaque.length).toBe(6)
      }
    }),
  )

  it.effect('consults the neighbour on the side the face points at, and no other', () =>
    Effect.sync(() => {
      // Cross-wiring xNeg to xPos is symmetric enough to survive a test that
      // supplies all four neighbours at once. Supplying exactly one at a time
      // is what makes the wiring observable.
      for (const seam of SEAMS) {
        for (const other of SEAMS) {
          const layers = meshChunk(
            chunkWith([[...seam.cell, STONE]]),
            { [other.direction]: chunkWith([[...seam.touching, STONE]]) },
            EMPTY_MESH_CONFIG,
          )
          expect(layers.opaque.length).toBe(other.direction === seam.direction ? 5 : 6)
        }
      }
    }),
  )
})

describe('getBlockAcrossBoundary', () => {
  // One neighbour per side, each holding a single block with a DISTINCT id at
  // a DISTINCT height and tangent offset. Any mix-up — wrong neighbour, wrong
  // face of the neighbour, transposed tangent — therefore reads an empty cell
  // and returns AIR rather than coincidentally returning the right answer.
  const XNEG = 11
  const XPOS = 12
  const ZNEG = 13
  const ZPOS = 14

  const NEIGHBOURS: ChunkNeighbours = {
    xNeg: chunkWith([[CHUNK_SIZE - 1, 40, 5, XNEG]]),
    xPos: chunkWith([[0, 41, 6, XPOS]]),
    zNeg: chunkWith([[7, 42, CHUNK_SIZE - 1, ZNEG]]),
    zPos: chunkWith([[8, 43, 0, ZPOS]]),
  }

  const CHUNK = chunkWith([[9, 44, 9, STONE]])

  it.effect('maps each out-of-range side to the facing column of the right neighbour', () =>
    Effect.sync(() => {
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, -1, 40, 5)).toBe(XNEG)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, CHUNK_SIZE, 41, 6)).toBe(XPOS)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 7, 42, -1)).toBe(ZNEG)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 8, 43, CHUNK_SIZE)).toBe(ZPOS)
    }),
  )

  it.effect('carries the tangent coordinate across unchanged, so a seam does not shear', () =>
    Effect.sync(() => {
      // The lz of an x-side read, and the lx of a z-side read, must survive the
      // hop. If either is dropped or swapped the neighbour is sampled along the
      // wrong line and the seam is stitched to the wrong column of blocks.
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, -1, 40, 6)).toBe(AIR)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, CHUNK_SIZE, 41, 5)).toBe(AIR)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 8, 42, -1)).toBe(AIR)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 7, 43, CHUNK_SIZE)).toBe(AIR)
    }),
  )

  it.effect('falls through to this chunk whenever the coordinate is in range', () =>
    Effect.sync(() => {
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 9, 44, 9)).toBe(STONE)
      expect(getBlockAcrossBoundary(CHUNK, NEIGHBOURS, 9, 45, 9)).toBe(AIR)
    }),
  )

  it.effect('reads an absent neighbour as air on every side, not just the one that was tested', () =>
    Effect.sync(() => {
      for (const [lx, y, lz] of [
        [-1, 40, 5],
        [CHUNK_SIZE, 41, 6],
        [7, 42, -1],
        [8, 43, CHUNK_SIZE],
      ] as const) {
        expect(getBlockAcrossBoundary(CHUNK, {}, lx, y, lz)).toBe(AIR)
      }
    }),
  )
})

describe('result ownership', () => {
  it.effect('REGRESSION: a later call cannot disturb the result of an earlier one', () =>
    Effect.sync(() => {
      // meshing-result-is-owned-not-aliased. The reference returns zero-copy
      // subarray VIEWS into one shared accumulator, valid only until the next
      // greedyMeshChunk call; a caller who keeps a result sees the next chunk's
      // data appear inside it. This repository returns owned arrays instead,
      // and docs/design-notes.md M-5 says the pooled fast path is still to come.
      //
      // That is precisely why this test exists NOW. Today it cannot fail; the
      // day someone lands the pool it becomes the thing that stops the change
      // from being invisible, and whoever writes that pool has to come here and
      // argue with this comment rather than silently invalidate every caller.
      const first = meshChunk(chunkWith([[2, 64, 2, STONE]]), {}, EMPTY_MESH_CONFIG)
      const heldOpaque = first.opaque
      const snapshot = first.opaque.map(positionOf)

      const second = meshChunk(
        chunkWith([
          [9, 12, 9, STONE],
          [9, 13, 9, STONE],
          [4, 70, 4, WATER],
        ]),
        {},
        CONFIG,
      )

      expect(first.opaque).toBe(heldOpaque)
      expect(first.opaque).not.toBe(second.opaque)
      expect(first.opaque.map(positionOf)).toStrictEqual(snapshot)
      expect(first.opaque.length).toBe(6)
      // The second result is the one that is actually different, so a pool that
      // merely copied the first result forward would not pass either.
      expect(second.opaque.length).toBe(10)
      expect(second.water.length).toBe(6)
      expect(first.water.length).toBe(0)
    }),
  )

  it.effect('gives every layer its own array, so holding one does not pin the others', () =>
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
      expect(layers.opaque).not.toBe(layers.water)
      expect(layers.water).not.toBe(layers.transparentSolid)
      expect(layers.opaque).not.toBe(layers.transparentSolid)
      // An empty layer must be its own empty array too, not one shared constant
      // that a future pooled implementation could hand out and then fill in.
      const empty = meshChunk(emptyChunk(), {}, CONFIG)
      expect(empty.opaque).not.toBe(empty.water)
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
