/**
 * bench-meshing.ts — the meshing hot path, measured.
 *
 * Run: `pnpm bench`. Also `--update-baseline`, `--guard-tolerance=`, `--workload-tolerance=`.
 * NOT part of `pnpm verify`: CI runs on every pull request in a public
 * repository and wall-clock there is a shared resource. See docs/testing.md §7.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists before greedy meshing does
 * ---------------------------------------------------------------------------
 *
 * `domain/mesh.ts` carries the naive face extraction and says so: correct, not
 * yet fast. The greedy merge is the substance of this repository and its ENTIRE
 * justification is speed. Landing it without a benchmark would mean shipping an
 * optimisation nobody can show is one, and — worse — losing the ability to tell
 * later whether it still is. So the measurement comes first, and the naive
 * numbers below are what greedy meshing has to beat.
 *
 * plan.md §5.2 lists five performance exceptions "established by measurement —
 * do not 'fix' these into idiomatic Effect style". Two of them live here, and
 * until now they were protected by a comment plus a test that checks only the
 * TYPE (`instanceof Set`). A type check catches the swap; it does not tell a
 * reviewer what the swap would COST, which is the argument that actually stops
 * it. The guards below supply the cost.
 *
 * ---------------------------------------------------------------------------
 * Provenance of the fixtures
 * ---------------------------------------------------------------------------
 *
 * flat / rolling / checkerboard are ported from the reference implementation's
 * `scripts/bench-meshing.ts` — same shapes, same `sin(x*0.7)*cos(z*0.5)`
 * rolling surface, same `(x+y+z)%2` checkerboard, same x81 chunk framing
 * (renderDistance=4). They are fully deterministic: no PRNG, no clock, no
 * input. Block ids are local constants because mc-meshing deliberately has no
 * block registry — ids are opaque numbers injected through `MeshConfig` — where
 * the reference reached its via `blockTypeToIndex('STONE')`.
 */
import { HashSet, Option } from 'effect'
import {
  AIR,
  BLOCKS_PER_CHUNK,
  blockIndex,
  buildLayerLookup,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  FACES,
  getBlock,
  MESH_LAYERS,
  meshChunk,
  totalQuadCount,
  type ChunkView,
  type MeshConfig,
} from '../index'
import {
  checkGuards,
  checkWorkloads,
  formatCheck,
  formatGuard,
  formatWorkload,
  guardRatio,
  measure,
  readBaseline,
  SHIPPED_VS_FROZEN_TOLERANCE,
  tolerancesFrom,
  wantsBaselineUpdate,
  writeBaseline,
  type Baseline,
  type Guard,
  type MeasureOptions,
  type Workload,
} from './bench-harness'

const BASELINE_PATH = new URL('./bench-baseline.json', import.meta.url).pathname

/** Opaque ids. mc-meshing has no registry; `MeshConfig` is the only source of truth. */
const STONE = 1
const GRASS = 2
const WATER = 3
const GLASS = 4

const CONFIG: MeshConfig = {
  waterBlockIds: new Set([WATER]),
  transparentSolidBlockIds: new Set([GLASS]),
}

const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')

/** The reference's count for this workload. Odd, so the median is an observation. */
const RUNS = 7

/**
 * Cells visited by a full six-pass mask build: 6 x 16 x 16 x 256 = 393,216.
 *
 * This is the "~400k calls/chunk" of plan.md §3.3 and of the reference's
 * `greedy-meshing-passes.ts:105`. docs/design-notes.md M-1 already establishes
 * that the figure is the six-pass cell count rather than a lookup count; the
 * guards below spend exactly that many lookups, so what they report is the
 * per-chunk cost and not a scaled-up microbenchmark.
 */
const MASK_CELLS = FACES.length * CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT

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
 * so a layer-routing regression would otherwise be invisible to this file.
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
 * Anything a measured loop computes has to be observed somewhere, or a
 * sufficiently clever JIT is entitled to delete the loop and the benchmark then
 * measures nothing. Every arm accumulates into this; the total is printed.
 */
let sink = 0

// ---------------------------------------------------------------------------
// The yardstick
// ---------------------------------------------------------------------------

/**
 * Six linear passes summing a chunk's 65,536 bytes.
 *
 * The machine-speed reference for the `workloads` ratios. Chosen to share the
 * memory-access character of the six face passes rather than to be a pure ALU
 * loop, so that a machine with a different cache hierarchy moves the yardstick
 * and the workload in roughly the same direction. "Roughly" is the honest word;
 * see the harness header on why workload ratios carry a looser tolerance than
 * guard ratios do.
 */
const yardstickOver = (blocks: Readonly<Uint8Array>) => (): void => {
  let total = 0
  for (let pass = 0; pass < FACES.length; pass += 1) {
    for (let index = 0; index < BLOCKS_PER_CHUNK; index += 1) {
      total += blocks[index] ?? 0
    }
  }
  sink += total
}

// ---------------------------------------------------------------------------
// Guard 1 — meshing-transparency-sets-are-native (docs/design-notes.md M-1)
// ---------------------------------------------------------------------------

/**
 * Deterministic block ids to probe, one per mask cell.
 *
 * A fixed 32-bit LCG rather than `Math.random`, so the hit/miss mix is
 * byte-identical on every machine and every run — a membership benchmark whose
 * hit rate drifts is a membership benchmark that reports noise. Ids 0..7 give a
 * realistic mix: mostly misses (air and stone dominate a real chunk) with water
 * and glass hitting often enough to exercise the found path.
 */
const probeIds = (): Uint8Array => {
  const ids = new Uint8Array(MASK_CELLS)
  let state = 0x12345678
  for (let index = 0; index < MASK_CELLS; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    ids[index] = (state >>> 24) % 8
  }
  return ids
}

const PROBE_IDS = probeIds()

const NATIVE_WATER = CONFIG.waterBlockIds
const NATIVE_GLASS = CONFIG.transparentSolidBlockIds

const nativeSetArm = (): void => {
  let hits = 0
  for (let index = 0; index < MASK_CELLS; index += 1) {
    const id = PROBE_IDS[index] ?? 0
    if (NATIVE_GLASS.has(id) || NATIVE_WATER.has(id)) {
      hits += 1
    }
  }
  sink += hits
}

const HASH_WATER = HashSet.fromIterable([WATER])
const HASH_GLASS = HashSet.fromIterable([GLASS])

const hashSetArm = (): void => {
  let hits = 0
  for (let index = 0; index < MASK_CELLS; index += 1) {
    const id = PROBE_IDS[index] ?? 0
    if (HashSet.has(HASH_GLASS, id) || HashSet.has(HASH_WATER, id)) {
      hits += 1
    }
  }
  sink += hits
}

const LOOKUP = buildLayerLookup(CONFIG)

const lookupTableArm = (): void => {
  let hits = 0
  for (let index = 0; index < MASK_CELLS; index += 1) {
    if (LOOKUP[PROBE_IDS[index] ?? 0] !== OPAQUE_LAYER) {
      hits += 1
    }
  }
  sink += hits
}

// ---------------------------------------------------------------------------
// Guard 2 — meshing-get-block-is-allocation-free (docs/design-notes.md M-2)
// ---------------------------------------------------------------------------

/**
 * The `Option`-returning `getBlock` that plan.md §5.2 exists to forbid.
 *
 * Written out rather than described, because "an Option allocates a Some per
 * in-bounds read" is a claim, and a claim in a comment is exactly what this file
 * is trying to replace. Semantically identical to `getBlock` modulo the wrapper;
 * the arm below unwraps with the same `AIR` default.
 */
const getBlockOption = (
  blocks: Readonly<Uint8Array>,
  lx: number,
  y: number,
  lz: number,
): Option.Option<number> => {
  if (lx < 0 || lx >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || lz < 0 || lz >= CHUNK_SIZE) {
    return Option.none()
  }
  return Option.fromNullable(blocks[y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE])
}

/**
 * The two arms are written out separately rather than parameterised by a `read`
 * callback on purpose: a shared callback makes both call sites polymorphic, and
 * the indirect-call overhead it adds to both would dilute exactly the difference
 * being measured. Each arm below is monomorphic, as the real meshing loop is.
 *
 * Both walk every cell's neighbour across every face — the same 393,216 reads,
 * including the same 1-cell out-of-bounds shell, that meshing performs.
 */
const plainWalkArm = (blocks: Readonly<Uint8Array>) => (): void => {
  let total = 0
  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          total += getBlock(blocks, lx + face.nx, y + face.ny, lz + face.nz)
        }
      }
    }
  }
  sink += total
}

/**
 * A frozen copy of what `getBlock` is today: six inlined bounds comparisons,
 * a `number` return, `AIR` out of bounds.
 *
 * This arm is the actual GATE for M-2, and the `Option` arm above is the price
 * list. Timing the shipped `getBlock` against a rewrite proves nothing on its
 * own — the ratio moves the same way whichever side changes. Timing it against
 * a frozen copy of its own current shape pins the shipped function.
 *
 * The recorded ratio is 0.94 rather than exactly 1.00: the frozen copy is local
 * to this module and V8 inlines it slightly better than the cross-module import.
 * That gap is stable to within a few percent across runs, which is all a
 * baseline needs. What matters is that it COLLAPSES when `getBlock` gets slower
 * — an Option-returning rewrite of it measures 0.39 here, far outside the 1.5x
 * guard tolerance.
 */
const frozenGetBlock = (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number): number => {
  if (lx < 0 || lx >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || lz < 0 || lz >= CHUNK_SIZE) {
    return AIR
  }
  return blocks[y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE] ?? AIR
}

const frozenWalkArm = (blocks: Readonly<Uint8Array>) => (): void => {
  let total = 0
  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          total += frozenGetBlock(blocks, lx + face.nx, y + face.ny, lz + face.nz)
        }
      }
    }
  }
  sink += total
}

const optionWalkArm = (blocks: Readonly<Uint8Array>) => (): void => {
  let total = 0
  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          total += Option.getOrElse(
            getBlockOption(blocks, lx + face.nx, y + face.ny, lz + face.nz),
            () => AIR,
          )
        }
      }
    }
  }
  sink += total
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const options = (iterations: number, warmupIterations = iterations): MeasureOptions => ({
  iterations,
  warmupIterations,
  runs: RUNS,
})

const main = async (): Promise<number> => {
  const tolerances = tolerancesFrom(process.argv)
  const rolling = rollingChunk()

  console.log('mc-meshing benchmark — median of 7 timed runs after warmup, per the reference implementation\n')
  console.log(`  mask cells per chunk: ${String(MASK_CELLS)}  (6 faces x 16 x 16 x 256)`)
  console.log(`  load-time framing:    x81 chunks at renderDistance=4\n`)

  const nativeMs = measure(nativeSetArm, options(10, 20))
  const lookupMs = measure(lookupTableArm, options(10, 20))
  const hashMs = measure(hashSetArm, options(5, 10))
  const plainMs = measure(plainWalkArm(rolling.blocks), options(20, 40))
  const frozenMs = measure(frozenWalkArm(rolling.blocks), options(20, 40))
  const optionMs = measure(optionWalkArm(rolling.blocks), options(20, 40))

  const guards: ReadonlyArray<Guard> = [
    {
      // THE GATE for M-2: the shipped `getBlock` against a frozen copy of its
      // own current shape. Expected ~1.0; it drops if `getBlock` gets slower,
      // whatever the reason.
      name: 'neighbour-read/shipped-vs-frozen-inline-reference',
      regression: 'meshing-get-block-is-allocation-free',
      fastLabel: 'getBlock (shipped)',
      slowLabel: 'frozen inline copy',
      fastMs: plainMs,
      slowMs: frozenMs,
      tolerance: SHIPPED_VS_FROZEN_TOLERANCE,
    },
    {
      // The exception as actually written: what the inner loop does today
      // (a byte-indexed table built once per config) against what an
      // Effect-idiomatic rewrite would do. This is the headline number.
      name: 'set-membership/hashset-vs-lookup-table',
      regression: 'meshing-transparency-sets-are-native',
      fastLabel: 'Uint8Array lookup',
      slowLabel: 'Effect HashSet.has',
      fastMs: lookupMs,
      slowMs: hashMs,
    },
    {
      name: 'set-membership/hashset-vs-native-set',
      regression: 'meshing-transparency-sets-are-native',
      fastLabel: 'native Set.has',
      slowLabel: 'Effect HashSet.has',
      fastMs: nativeMs,
      slowMs: hashMs,
    },
    {
      name: 'set-membership/native-set-vs-lookup-table',
      regression: 'meshing-transparency-sets-are-native',
      fastLabel: 'Uint8Array lookup',
      slowLabel: 'native Set.has',
      fastMs: lookupMs,
      slowMs: nativeMs,
    },
    {
      name: 'neighbour-read/option-vs-plain-number',
      regression: 'meshing-get-block-is-allocation-free',
      fastLabel: 'getBlock -> number',
      slowLabel: 'getBlock -> Option',
      fastMs: plainMs,
      slowMs: optionMs,
    },
  ]

  console.log('performance exceptions (plan.md §5.2) as A/B ratios — machine-independent:\n')
  for (const guard of guards) {
    console.log(formatGuard(guard))
    console.log(`  ${' '.repeat(4)}protects docs/design-notes.md regression: ${guard.regression}\n`)
  }

  // Deliberately more iterations than any other case: the yardstick divides
  // every workload figure, so its noise is every workload's noise.
  const yardstickMs = measure(yardstickOver(rolling.blocks), options(200, 400))

  const fixtures: ReadonlyArray<readonly [string, ChunkView, number]> = [
    ['meshChunk/flat', flatChunk(), 60],
    ['meshChunk/rolling', rolling, 60],
    ['meshChunk/checkerboard-worst', checkerChunk(), 60],
    ['meshChunk/layered-water-glass', layeredChunk(), 60],
  ]

  const workloads: ReadonlyArray<Workload> = fixtures.map(([name, chunk, iterations]) => {
    const msPerUnit = measure(() => {
      sink += meshChunk(chunk, {}, CONFIG).opaque.length
    }, options(iterations))
    return {
      name,
      msPerUnit,
      unit: 'chunk',
      detail: `${String(totalQuadCount(meshChunk(chunk, {}, CONFIG)))} quads`,
    }
  })

  console.log('end-to-end workloads — absolute figures are indicative only (see harness header):\n')
  console.log(`  ${'yardstick/six-linear-byte-passes'.padEnd(44)} ${yardstickMs.toFixed(4)} ms/pass`)
  for (const workload of workloads) {
    console.log(formatWorkload(workload))
  }
  console.log('')

  if (wantsBaselineUpdate(process.argv)) {
    const recorded: Baseline = {
      version: 1,
      recordedOn: process.env['BENCH_MACHINE'] ?? 'unrecorded machine',
      note:
        'guards are slow/fast A/B ratios measured in one process and are machine-independent; ' +
        'workloads are workload/yardstick ratios and are only approximately so. ' +
        'Regenerate with `pnpm bench --update-baseline` and say in the commit message what moved and why.',
      guards: Object.fromEntries(guards.map((guard) => [guard.name, Number(guardRatio(guard).toPrecision(4))])),
      workloads: Object.fromEntries(
        workloads.map((workload) => [workload.name, Number((workload.msPerUnit / yardstickMs).toPrecision(4))]),
      ),
    }
    await writeBaseline(BASELINE_PATH, recorded)
    console.log(`baseline written to scripts/bench-baseline.json  (sink ${String(sink)})`)
    return 0
  }

  const baseline = await readBaseline(BASELINE_PATH)
  const results = [
    ...checkGuards(guards, baseline, tolerances.guard),
    ...checkWorkloads(workloads, yardstickMs, baseline, tolerances.workload),
  ]

  console.log(
    `baseline comparison (guard tolerance ${tolerances.guard.toFixed(2)}x, ` +
      `workload tolerance ${tolerances.workload.toFixed(2)}x):\n`,
  )
  for (const result of results) {
    console.log(formatCheck(result))
  }
  console.log('')

  const regressed = results.filter((result) => result.status === 'regressed')
  if (regressed.length > 0) {
    console.error(`${String(regressed.length)} regression(s) against scripts/bench-baseline.json.`)
    console.error('If the change is intended, re-record with `pnpm bench --update-baseline`.')
    return 1
  }

  console.log(`no regressions  (sink ${String(sink)})`)
  return 0
}

process.exit(await main())
