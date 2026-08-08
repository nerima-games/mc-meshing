/**
 * Ambient occlusion: which cells are sampled, what the count clamps to, and how
 * it behaves at a chunk boundary.
 *
 * The interaction with greedy merging is tested in `test/mesh.test.ts`, where
 * the merge is. This file is about the value itself.
 *
 * Regression names (docs/design-notes.md):
 *   meshing-ao-samples-the-air-cells-tangent-neighbours
 *   meshing-ao-clamps-to-three
 *   meshing-ao-crosses-a-loaded-boundary
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import { AO_LEVELS, AO_MAX, AO_NONE, ambientOcclusionAt } from '../src/domain/ambient-occlusion'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  type ChunkView,
  blockIndex,
  emptyChunk,
} from '../src/domain/chunk-view'
import { FACE_DIRECTIONS, type FaceDirection } from '../src/domain/faces'

const STONE = 1
const WATER = 2
const GLASS = 3

/** Well clear of every chunk face, so no test below is measuring a boundary by accident. */
const CENTRE = [8, 64, 8] as const

type Cell = readonly [number, number, number]

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint8Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz)] = blockId
  }
  return { blocks }
}

const shifted = (cell: Cell, offset: Cell): readonly [number, number, number, number] => [
  cell[0] + offset[0],
  cell[1] + offset[1],
  cell[2] + offset[2],
  STONE,
]

/**
 * THE TABLE THIS FILE EXISTS FOR: the four offsets, from the emitting cell, of
 * the cells whose presence darkens each face.
 *
 * TRANSCRIBED FROM THE REFERENCE, not derived from `domain/ambient-occlusion.ts`
 * and not from `tangentAxes`. The implementation builds these by composing
 * `faceOf` with `tangentAxes`, which is the right way to write it once — and it
 * is exactly why the test must not do the same thing, or a sign error in
 * `tangentAxes` would flip both sides together and this file would agree with
 * the bug. `test/mesh.test.ts` makes the same choice for the emission-order
 * table and says so.
 *
 * Read off `packages/rendering/infrastructure/meshing/greedy-meshing-ao.ts`,
 * one function per row, subtracting the emitting cell `(lx, y, lz)` from each
 * indexed cell:
 *
 *   aoXPos :15-25   air cell (lx+1, y, lz); samples y-1, y+1, lz-1, lz+1 there
 *   aoXNeg :27-37   air cell (lx-1, y, lz); same four
 *   aoYPos :39-50   air cell (lx, y+1, lz); samples lx+1, lx-1, lz+1, lz-1 there
 *   aoYNeg :52-63   air cell (lx, y-1, lz); same four
 *   aoZPos :65-75   air cell (lx, y, lz+1); samples lx+1, lx-1, y+1, y-1 there
 *   aoZNeg :77-87   air cell (lx, y, lz-1); same four
 */
const OCCLUDING_OFFSETS: Readonly<Record<FaceDirection, ReadonlyArray<Cell>>> = {
  xNeg: [
    [-1, -1, 0],
    [-1, 1, 0],
    [-1, 0, -1],
    [-1, 0, 1],
  ],
  xPos: [
    [1, -1, 0],
    [1, 1, 0],
    [1, 0, -1],
    [1, 0, 1],
  ],
  yNeg: [
    [1, -1, 0],
    [-1, -1, 0],
    [0, -1, 1],
    [0, -1, -1],
  ],
  yPos: [
    [1, 1, 0],
    [-1, 1, 0],
    [0, 1, 1],
    [0, 1, -1],
  ],
  zNeg: [
    [1, 0, -1],
    [-1, 0, -1],
    [0, 1, -1],
    [0, -1, -1],
  ],
  zPos: [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
  ],
}

/**
 * Cells that must NOT darken each face, and each one names a specific bug.
 *
 *  - the AIR CELL ITSELF (`normal`). The reference samples the air cell's
 *    NEIGHBOURS, never the air cell; a block there is what the face is pressed
 *    against, and it is `isFaceExposed`'s business, not AO's.
 *  - `2 * normal`, one step beyond the air cell. Reached by an implementation
 *    that offset twice along the normal instead of once along a tangent.
 *  - `-normal`, the cell behind the emitter. Reached by a flipped normal.
 *  - the four DIAGONALS of the air cell. The eight-voxel per-vertex AO of the
 *    0fps article and of Minecraft counts these; the reference's four-neighbour
 *    count does not, and `domain/ambient-occlusion.ts` argues at length that the
 *    difference is what makes AO compatible with merging at all. If these ever
 *    start counting, someone has quietly swapped in the other algorithm.
 *  - the emitter's OWN tangent neighbours, i.e. an offset with no normal
 *    component. Reached by sampling around `(lx, y, lz)` instead of around the
 *    air cell — an off-by-one in the most plausible direction.
 */
const NON_OCCLUDING_OFFSETS: Readonly<Record<FaceDirection, ReadonlyArray<Cell>>> = {
  xNeg: [
    [-1, 0, 0],
    [-2, 0, 0],
    [1, 0, 0],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
    [0, 1, 0],
    [0, 0, 1],
  ],
  xPos: [
    [1, 0, 0],
    [2, 0, 0],
    [-1, 0, 0],
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [0, 1, 0],
    [0, 0, 1],
  ],
  yNeg: [
    [0, -1, 0],
    [0, -2, 0],
    [0, 1, 0],
    [1, -1, 1],
    [1, -1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
    [1, 0, 0],
    [0, 0, 1],
  ],
  yPos: [
    [0, 1, 0],
    [0, 2, 0],
    [0, -1, 0],
    [1, 1, 1],
    [1, 1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [1, 0, 0],
    [0, 0, 1],
  ],
  zNeg: [
    [0, 0, -1],
    [0, 0, -2],
    [0, 0, 1],
    [1, 1, -1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, -1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  zPos: [
    [0, 0, 1],
    [0, 0, 2],
    [0, 0, -1],
    [1, 1, 1],
    [1, -1, 1],
    [-1, 1, 1],
    [-1, -1, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
}

describe('the sampled cells', () => {
  it.effect('an isolated block is unoccluded on all six faces', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[...CENTRE, STONE]])
      for (const direction of FACE_DIRECTIONS) {
        expect(ambientOcclusionAt(chunk, {}, direction, ...CENTRE)).toBe(AO_NONE)
      }
    }),
  )

  it.effect('each of the four tangent neighbours of the air cell darkens the face by exactly one', () =>
    Effect.sync(() => {
      // Meshing-ao-samples-the-air-cells-tangent-neighbours. One occluder at a
      // Time: a test that placed all four at once would report 3 (the clamp) and
      // Could not tell which of the four was actually being read, so a
      // Transposed axis that sampled some OTHER four cells would still show 3.
      for (const direction of FACE_DIRECTIONS) {
        for (const offset of OCCLUDING_OFFSETS[direction]) {
          const chunk = chunkWith([[...CENTRE, STONE], shifted(CENTRE, offset)])
          expect({ ao: ambientOcclusionAt(chunk, {}, direction, ...CENTRE), direction, offset }).toStrictEqual({
            ao: 1,
            direction,
            offset,
          })
        }
      }
    }),
  )

  it.effect('no other neighbour darkens it, including every diagonal the per-vertex algorithm would count', () =>
    Effect.sync(() => {
      // The other half, and the half that fails when the sampled cells are the
      // Right SHAPE around the wrong CENTRE. See NON_OCCLUDING_OFFSETS for what
      // Each entry catches.
      for (const direction of FACE_DIRECTIONS) {
        for (const offset of NON_OCCLUDING_OFFSETS[direction]) {
          const chunk = chunkWith([[...CENTRE, STONE], shifted(CENTRE, offset)])
          expect({ ao: ambientOcclusionAt(chunk, {}, direction, ...CENTRE), direction, offset }).toStrictEqual({
            ao: AO_NONE,
            direction,
            offset,
          })
        }
      }
    }),
  )

  it.effect('the two tables are disjoint, so the pair of tests above cannot both be vacuous', () =>
    Effect.sync(() => {
      // If an offset appeared in both tables the two tests would contradict each
      // Other and one of them would have to be wrong; if either table were empty
      // Its test would pass by doing nothing.
      for (const direction of FACE_DIRECTIONS) {
        const occluding = new Set(OCCLUDING_OFFSETS[direction].map((offset) => offset.join(',')))
        const inert = new Set(NON_OCCLUDING_OFFSETS[direction].map((offset) => offset.join(',')))
        expect(occluding.size).toBe(4)
        expect(inert.size).toBe(9)
        for (const key of inert) {
          expect(occluding.has(key)).toBe(false)
        }
      }
    }),
  )

  it.effect('the six directions sample six different sets of cells', () =>
    Effect.sync(() => {
      // Two directions that agreed would mean a face reading its neighbour's
      // Shading — the whole table collapsing onto one row is the failure mode a
      // Per-direction table exists to prevent, and it is invisible to the tests
      // Above, which check each row against itself.
      const rows = FACE_DIRECTIONS.map((direction) =>
        [...OCCLUDING_OFFSETS[direction]].map((offset) => offset.join(',')).sort().join('|'),
      )
      expect(new Set(rows).size).toBe(FACE_DIRECTIONS.length)
    }),
  )
})

describe('the clamp', () => {
  it.effect('four occluders report AO_MAX, not four', () =>
    Effect.sync(() => {
      // Meshing-ao-clamps-to-three. The count runs 0..4 and the field is two
      // Bits wide (`greedy-meshing-passes.ts:10`), so an unclamped 4 would
      // Overflow into the block id's neighbour in the packed mask cell. The
      // Reference clamps with `count > 3 ? 3 : count`
      // (`greedy-meshing-ao.ts:24` and the five siblings).
      for (const direction of FACE_DIRECTIONS) {
        const chunk = chunkWith([
          [...CENTRE, STONE],
          ...OCCLUDING_OFFSETS[direction].map((offset) => shifted(CENTRE, offset)),
        ])
        expect(ambientOcclusionAt(chunk, {}, direction, ...CENTRE)).toBe(AO_MAX)
      }
    }),
  )

  it.effect('three occluders also report AO_MAX, so the clamp is a ceiling and not a special case', () =>
    Effect.sync(() => {
      for (const direction of FACE_DIRECTIONS) {
        const chunk = chunkWith([
          [...CENTRE, STONE],
          ...OCCLUDING_OFFSETS[direction].slice(0, 3).map((offset) => shifted(CENTRE, offset)),
        ])
        expect(ambientOcclusionAt(chunk, {}, direction, ...CENTRE)).toBe(AO_MAX)
      }
    }),
  )

  it.effect('AO_MAX is one below AO_LEVELS, and both are what two bits hold', () =>
    Effect.sync(() => {
      expect(AO_LEVELS).toBe(4)
      expect(AO_MAX).toBe(AO_LEVELS - 1)
      expect(AO_NONE).toBe(0)
    }),
  )

  it.effect('is always in range and never decreases when a block is added', () =>
    Effect.sync(() => {
      // Monotonicity is the shape of the rule rather than any particular value:
      // Occlusion counts non-air cells, so filling an air cell can only add to
      // The count, never remove from it. An implementation that subtracted
      // Somewhere, or that read the emitting block's own id into the count,
      // Breaks this without breaking any fixed fixture.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(...FACE_DIRECTIONS),
          FastCheck.array(
            FastCheck.tuple(
              FastCheck.integer({ max: 10, min: 6 }),
              FastCheck.integer({ max: 66, min: 62 }),
              FastCheck.integer({ max: 10, min: 6 }),
              FastCheck.constantFrom(STONE, WATER, GLASS),
            ),
            { maxLength: 12, minLength: 0 },
          ),
          FastCheck.tuple(
            FastCheck.integer({ max: 10, min: 6 }),
            FastCheck.integer({ max: 66, min: 62 }),
            FastCheck.integer({ max: 10, min: 6 }),
          ),
          (direction, cells, [addX, addY, addZ]) => {
            const before = chunkWith([[...CENTRE, STONE], ...cells])
            const after = chunkWith([[...CENTRE, STONE], ...cells, [addX, addY, addZ, STONE]])
            const beforeAo = ambientOcclusionAt(before, {}, direction, ...CENTRE)
            const afterAo = ambientOcclusionAt(after, {}, direction, ...CENTRE)
            return (
              beforeAo >= AO_NONE && beforeAo <= AO_MAX && afterAo >= AO_NONE && afterAo <= AO_MAX && afterAo >= beforeAo
            )
          },
        ),
        { numRuns: 200 },
      )
    }),
  )
})

describe('what counts as an occluder', () => {
  it.effect('any non-air block occludes, water and glass included', () =>
    Effect.sync(() => {
      // TRANSCRIBED, NOT JUSTIFIED. The reference tests `!== AIR`
      // (`greedy-meshing-ao.ts:20-23`), so a pane of glass darkens what it sits
      // Beside even though `domain/opacity.ts` is careful that glass never
      // OCCLUDES a face. Nothing in this repository has measured whether that is
      // Right; this test pins the rule as ported so that changing it has to be a
      // Decision rather than a drift. See docs/design-notes.md M-10.
      for (const blockId of [STONE, WATER, GLASS, 255]) {
        const chunk = chunkWith([
          [...CENTRE, STONE],
          [CENTRE[0], CENTRE[1] + 1, CENTRE[2] + 1, blockId],
        ])
        expect(ambientOcclusionAt(chunk, {}, 'yPos', ...CENTRE)).toBe(1)
      }
    }),
  )

  it.effect('the emitting block is not its own occluder, whatever it is made of', () =>
    Effect.sync(() => {
      for (const blockId of [STONE, WATER, GLASS, 255]) {
        const chunk = chunkWith([[...CENTRE, blockId]])
        for (const direction of FACE_DIRECTIONS) {
          expect(ambientOcclusionAt(chunk, {}, direction, ...CENTRE)).toBe(AO_NONE)
        }
      }
    }),
  )
})

describe('chunk boundaries', () => {
  /**
   * A cell on the -X face of the chunk, and the neighbour cell that its xNeg
   * face's AO must read.
   *
   * `lz` is 5 rather than 0 for the reason `test/mesh.test.ts` gives about its
   * own seams: at 0 a transposed index still lands on a real cell.
   */
  const EDGE = [0, 64, 5] as const

  it.effect('an absent neighbour reads as air, which is the reference’s answer', () =>
    Effect.sync(() => {
      // The reference does not read across the boundary at all — it returns 0
      // Outright (`greedy-meshing-ao.ts:28`, `if (lx <= 0) return 0`). With no
      // Neighbour loaded this port must agree with it exactly, which is what
      // Makes the deviation below free rather than a behaviour change.
      const chunk = chunkWith([[...EDGE, STONE]])
      expect(ambientOcclusionAt(chunk, {}, 'xNeg', ...EDGE)).toBe(AO_NONE)
    }),
  )

  it.effect('a loaded neighbour DOES occlude, so the seam is not a bright ring', () =>
    Effect.sync(() => {
      // Meshing-ao-crosses-a-loaded-boundary. THE DELIBERATE DEVIATION. The air
      // Cell is at lx=-1, i.e. lx=CHUNK_SIZE-1 of the xNeg neighbour, and its
      // Two Y neighbours and two Z neighbours live there too. Zero is the
      // BRIGHTEST value, so the reference's early return draws an unoccluded
      // Ring around every chunk on terrain that is continuous.
      const neighbour = chunkWith([[CHUNK_SIZE - 1, 65, 5, STONE]])
      const chunk = chunkWith([[...EDGE, STONE]])
      expect(ambientOcclusionAt(chunk, { xNeg: neighbour }, 'xNeg', ...EDGE)).toBe(1)
    }),
  )

  it.effect('consults the neighbour on the side the face points at, and no other', () =>
    Effect.sync(() => {
      // Supplying the right block through the WRONG neighbour must change
      // Nothing. Without this, cross-wiring xNeg to xPos survives.
      const neighbour = chunkWith([[CHUNK_SIZE - 1, 65, 5, STONE]])
      const chunk = chunkWith([[...EDGE, STONE]])
      for (const side of ['xPos', 'zPos', 'zNeg'] as const) {
        expect(ambientOcclusionAt(chunk, { [side]: neighbour }, 'xNeg', ...EDGE)).toBe(AO_NONE)
      }
    }),
  )

  it.effect('reads the column that touches the seam, not merely some column in the neighbour', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[...EDGE, STONE]])
      // Right side, right height, WRONG depth into the neighbour.
      expect(ambientOcclusionAt(chunk, { xNeg: chunkWith([[0, 65, 5, STONE]]) }, 'xNeg', ...EDGE)).toBe(AO_NONE)
      // Right side, right depth, wrong tangent — a sheared seam.
      expect(
        ambientOcclusionAt(chunk, { xNeg: chunkWith([[CHUNK_SIZE - 1, 65, 6, STONE]]) }, 'xNeg', ...EDGE),
      ).toBe(AO_NONE)
    }),
  )

  it.effect('a loaded diagonal neighbour darkens the matching chunk corner', () =>
    Effect.sync(() => {
      const corner = [0, 64, 0] as const
      const chunk = chunkWith([[...corner, STONE]])
      const diagonal = chunkWith([[CHUNK_SIZE - 1, 64, CHUNK_SIZE - 1, STONE]])
      expect(ambientOcclusionAt(chunk, { xNegZNeg: diagonal }, 'xNeg', ...corner)).toBe(1)
      expect(ambientOcclusionAt(chunk, {}, 'xNeg', ...corner)).toBe(AO_NONE)
    }),
  )

  it.effect('the world ceiling and floor read as air rather than throwing', () =>
    Effect.sync(() => {
      // Y is not a chunk axis with a neighbour — chunks are full-height columns
      // (`domain/chunk-view.ts`) — so the samples above y=255 and below y=0 have
      // Nowhere to come from at all.
      const roof = [8, CHUNK_HEIGHT - 1, 8] as const
      const floor = [8, 0, 8] as const
      const chunk = chunkWith([
        [...roof, STONE],
        [...floor, STONE],
      ])
      expect(ambientOcclusionAt(chunk, {}, 'yPos', ...roof)).toBe(AO_NONE)
      expect(ambientOcclusionAt(chunk, {}, 'yNeg', ...floor)).toBe(AO_NONE)
    }),
  )

  it.effect('is defined for an air cell and for an empty chunk: it never reads the emitter', () =>
    Effect.sync(() => {
      // `ambientOcclusionAt` is a function of the SURROUNDINGS. Asking it about a
      // Cell that holds nothing is meaningless to a caller but must still be
      // Total, because it is called from two meshers and a change to either
      // Could reorder the exposure check and the AO computation.
      const chunk = chunkWith([[9, 64, 8, STONE]])
      expect(ambientOcclusionAt(chunk, {}, 'yPos', ...CENTRE)).toBe(AO_NONE)
      expect(ambientOcclusionAt(emptyChunk(), {}, 'yPos', ...CENTRE)).toBe(AO_NONE)
    }),
  )
})

describe('a shape with a real inside corner', () => {
  it.effect('an L of blocks darkens exactly the faces the corner encloses', () =>
    Effect.sync(() => {
      // Worked by hand rather than by running the code, because every other
      // Fixture in this file is one occluder in isolation and none of them shows
      // The value the renderer will actually see on terrain.
      //
      // Three blocks in the y=64 plane forming an L around (8, 64, 8):
      //   (8,64,8) the corner, (9,64,8) along +X, (8,64,9) along +Z.
      const chunk = chunkWith([
        [8, 64, 8, STONE],
        [9, 64, 8, STONE],
        [8, 64, 9, STONE],
      ])

      // The corner block's TOP face. Air cell (8,65,8); samples (9,65,8),
      // (7,65,8), (8,65,9), (8,65,7) — all air, nothing is stacked. So a flat
      // Plate is not self-shadowing, which is the property that keeps the flat
      // Fixture at ten quads.
      expect(ambientOcclusionAt(chunk, {}, 'yPos', 8, 64, 8)).toBe(AO_NONE)

      // The corner block's -X face. Air cell (7,64,8); samples (7,63,8),
      // (7,65,8), (7,64,7), (7,64,9) — all air. Facing away from the L.
      expect(ambientOcclusionAt(chunk, {}, 'xNeg', 8, 64, 8)).toBe(AO_NONE)

      // The +X block's -Z face. Air cell (9,64,7); samples (10,64,7), (8,64,7),
      // (9,65,7), (9,63,7) — all air.
      expect(ambientOcclusionAt(chunk, {}, 'zNeg', 9, 64, 8)).toBe(AO_NONE)

      // The +X block's +Z face is the inside of the corner. Air cell (9,64,9);
      // Samples (10,64,9), (8,64,9), (9,65,9), (9,63,9). Exactly one of those,
      // (8,64,9), is the third block of the L — so this face is darkened by one
      // And its neighbours are not. That single step is what AO renders as a
      // Crease, and it is the reason this face can no longer merge with the
      // Corner block's +Z face beside it, which reads 0.
      expect(ambientOcclusionAt(chunk, {}, 'zPos', 9, 64, 8)).toBe(1)
      expect(ambientOcclusionAt(chunk, {}, 'zPos', 8, 64, 8)).toBe(AO_NONE)
    }),
  )
})
