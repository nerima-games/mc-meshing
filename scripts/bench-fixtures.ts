/**
 * bench-fixtures.ts — the chunk shapes every measurement in this repository runs on.
 *
 * Lifted out of `bench-meshing.ts` unchanged when LOD simplification arrived and
 * needed the same four shapes. The move is mechanical and deliberate: that file
 * ends in `process.exit(await main())`, so importing it to reach a fixture would
 * run the whole benchmark and then kill the importing process. A test that wants
 * to state a quad count on the same terrain the benchmark times cannot do that,
 * and a second copy of the shapes would be a second thing to keep in step.
 *
 * ---------------------------------------------------------------------------
 * Provenance
 * ---------------------------------------------------------------------------
 *
 * flat / rolling / checkerboard are ported from the reference implementation's
 * `scripts/bench-meshing.ts` — same shapes, same `sin(x*0.7)*cos(z*0.5)` rolling
 * surface, same `(x+y+z)%2` checkerboard. `layered-water-glass` is this
 * repository's addition: the reference's benchmark only ever fed opaque blocks,
 * so the three-valued layer routing would otherwise never be measured.
 *
 * They are fully deterministic: no PRNG, no clock, no input. Block ids are local
 * constants because mc-meshing deliberately has no block registry — ids are
 * opaque numbers injected through `MeshConfig` — where the reference reached its
 * via `blockTypeToIndex('STONE')`.
 */
import {
  BLOCKS_PER_CHUNK,
  blockIndex,
  CHUNK_SIZE,
  type ChunkView,
  type MeshConfig,
} from '../src/index'

/** Opaque ids. mc-meshing has no registry; `MeshConfig` is the only source of truth. */
export const STONE = 1
export const GRASS = 2
export const WATER = 3
export const GLASS = 4

export const CONFIG: MeshConfig = {
  waterBlockIds: new Set([WATER]),
  transparentSolidBlockIds: new Set([GLASS]),
}

const newBlocks = (): Uint8Array => new Uint8Array(BLOCKS_PER_CHUNK)

const set = (blocks: Uint8Array, lx: number, y: number, lz: number, value: number): void => {
  blocks[blockIndex(lx, y, lz)] = value
}

/** Solid stone to y=62, grass at 63, air above. Few faces — best case. */
const flatChunk = (): ChunkView => {
  const blocks = newBlocks()
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let y = 0; y <= 62; y += 1) {
        set(blocks, lx, y, lz, STONE)
      }
      set(blocks, lx, 63, lz, GRASS)
    }
  }
  return { blocks }
}

/** Per-column height varying 56..72. A realistic surface — moderate faces. */
const rollingChunk = (): ChunkView => {
  const blocks = newBlocks()
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const height = 56 + Math.floor(8 * (1 + Math.sin(lx * 0.7) * Math.cos(lz * 0.5)))
      for (let y = 0; y < height; y += 1) {
        set(blocks, lx, y, lz, STONE)
      }
      set(blocks, lx, height, lz, GRASS)
    }
  }
  return { blocks }
}

/** Every cell in a 16^3 volume alternates solid/air. Worst case — maximum faces. */
const checkerChunk = (): ChunkView => {
  const blocks = newBlocks()
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let y = 0; y < CHUNK_SIZE; y += 1) {
        if ((lx + y + lz) % 2 === 0) {
          set(blocks, lx, y, lz, STONE)
        }
      }
    }
  }
  return { blocks }
}

/**
 * A lake under a glass roof: exercises all three layers and the same-layer cull.
 *
 * Not in the reference's fixture set. It is here because mc-meshing's routing is
 * three-valued where the reference's benchmark only ever fed it opaque blocks,
 * so a layer-routing regression would otherwise be invisible.
 */
const layeredChunk = (): ChunkView => {
  const blocks = newBlocks()
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let y = 0; y <= 50; y += 1) {
        set(blocks, lx, y, lz, STONE)
      }
      for (let y = 51; y <= 62; y += 1) {
        set(blocks, lx, y, lz, WATER)
      }
      set(blocks, lx, 63, lz, GLASS)
    }
  }
  return { blocks }
}

/**
 * Built once at module load and shared by every consumer. A `ChunkView` is read
 * only — `blocks` is a `Readonly<Uint8Array>` and meshing never writes to it —
 * so one instance per shape is enough, and one instance is what makes the
 * timings and the counts describe the same bytes.
 */
export const FLAT: ChunkView = flatChunk()
export const ROLLING: ChunkView = rollingChunk()
export const CHECKERBOARD: ChunkView = checkerChunk()
export const LAYERED: ChunkView = layeredChunk()

/**
 * A lake with a sloping bed, for the fluid surface pass.
 *
 * DELIBERATELY NOT ONE OF `BENCH_FIXTURES`, and that is the point. The four
 * shapes above are configured by `CONFIG`, which declares no fluid, so every
 * table and every recorded figure that iterates them is untouched by fluid
 * meshing landing — including the `layered-water-glass` quad counts that
 * docs/design-notes.md M-9 and M-10 record, whose water is still a cube.
 *
 * Fluid meshing is a different shape of cost from the six cube passes and wants
 * its own measurement rather than a share of theirs: it samples up to four
 * columns per corner and four corners per cell, so its price is set by how much
 * fluid there is, not by how many faces are exposed. Hence one fixture that is
 * mostly water and one workload timing it.
 *
 * The bed rises from y=40 to y=55 across the chunk so that the water above it
 * has a genuinely varying depth, and the levels step with `lx` so that the
 * corner averaging has something to average. A uniform lake would time the walk
 * but never exercise the slope.
 */
const lakeChunk = (): ChunkView => {
  const blocks = newBlocks()
  const levels = newBlocks()
  const sources = newBlocks()
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const bed = 40 + Math.floor((lx + lz) / 2)
      for (let y = 0; y <= bed; y += 1) {
        set(blocks, lx, y, lz, STONE)
      }
      for (let y = bed + 1; y <= 56; y += 1) {
        set(blocks, lx, y, lz, WATER)
        // Level 0 below the surface and a stepped level at the top, so that the
        // surface tilts and the submerged-cell rule is exercised underneath it.
        const index = blockIndex(lx, y, lz)
        levels[index] = y === 56 ? lx % 8 : 0
        sources[index] = y === 56 ? 0 : 1
      }
    }
  }
  return { blocks, fluid: { levels, sources } }
}

export const LAKE: ChunkView = lakeChunk()

/**
 * `CONFIG` plus the fluid table, used only by the lake workload.
 *
 * The max levels are the reference's — 7 for water
 * (`packages/block/domain/fluid-model.ts:15`). A benchmark may spell another
 * repository's constants; `domain/` may not, which is the whole reason
 * `fluidMaxLevels` is injected.
 */
export const FLUID_CONFIG: MeshConfig = {
  waterBlockIds: new Set([WATER]),
  transparentSolidBlockIds: new Set([GLASS]),
  fluidMaxLevels: new Map([[WATER, 7]]),
}

export type BenchFixture = {
  /** The name both the benchmark and the reduction table print. */
  readonly name: string
  readonly chunk: ChunkView
}

/**
 * The four shapes, in the order every table in this repository prints them:
 * best case, realistic case, worst case, then the three-layer case.
 */
export const BENCH_FIXTURES: ReadonlyArray<BenchFixture> = [
  { name: 'flat', chunk: FLAT },
  { name: 'rolling', chunk: ROLLING },
  { name: 'checkerboard-worst', chunk: CHECKERBOARD },
  { name: 'layered-water-glass', chunk: LAYERED },
]
