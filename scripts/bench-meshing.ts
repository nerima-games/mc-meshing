/**
 * Bench-meshing.ts — the meshing hot path, measured.
 *
 * Run: `pnpm bench`. Also `--update-baseline`, `--guard-tolerance=`, `--workload-tolerance=`.
 * NOT part of `pnpm verify`: CI runs on every pull request in a public
 * repository and wall-clock there is a shared resource. See docs/testing.md §7.
 *
 * ---------------------------------------------------------------------------
 * This file existed before greedy meshing did, and that was the point
 * ---------------------------------------------------------------------------
 *
 * The greedy merge is the substance of this repository and its ENTIRE
 * justification is speed. Landing it without a benchmark would have meant
 * shipping an optimisation nobody could show was one, and — worse — losing the
 * ability to tell later whether it still was. So the measurement came first.
 *
 * It has now paid for itself twice, and the second time is the interesting one.
 * The quad counts came out overwhelmingly in the merge's favour (flat 4,608 ->
 * 10). The TIMINGS did not: measured against the naive mesher with the Y-scan
 * ceiling held off, merging is 1.16-1.47x SLOWER on every fixture. The whole
 * wall-clock improvement belongs to `solidCeiling`, which landed in the same
 * change and is a different optimisation entirely. Without this file that would
 * have been reported as "greedy meshing made meshing twice as fast", which is
 * false, and nobody would have had any way to notice. See docs/design-notes.md
 * M-9 for the decomposition and how to reproduce it.
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
 * The four chunk shapes live in `bench-fixtures.ts` — three of them ported from
 * the reference's own benchmark, one added here for the three-valued layer
 * routing. They moved out of this file so that a test can state a quad count on
 * the same terrain this file times; see that file's header. The x81 chunk
 * framing (renderDistance=4) stays here, where the timings are.
 */
import { HashSet, Option } from 'effect'
import {
  AIR,
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  createMeshScratch,
  FACES,
  LOD_LEVELS,
  type LodLevel,
  MESH_LAYERS,
  type MeshLayers,
  buildLayerLookup,
  getBlock,
  meshChunk,
  meshChunkNaive,
  simplifyMesh,
  totalQuadArea,
  totalQuadCount,
} from '../src/index'
import { BENCH_FIXTURES, CONFIG, FLUID_CONFIG, GLASS, LAKE, ROLLING, WATER } from './bench-fixtures'
import {
  type Baseline,
  type Guard,
  type MeasureOptions,
  SHIPPED_VS_FROZEN_TOLERANCE,
  type Workload,
  checkGuards,
  checkWorkloads,
  formatCheck,
  formatGuard,
  formatWorkload,
  guardRatio,
  measure,
  readBaseline,
  tolerancesFrom,
  wantsBaselineUpdate,
  writeBaseline,
} from './bench-harness'

const BASELINE_PATH = new URL('./bench-baseline.json', import.meta.url).pathname

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
  const chunk = { blocks, height: CHUNK_HEIGHT }
  let total = 0
  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          total += getBlock(chunk, lx + face.nx, y + face.ny, lz + face.nz)
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
const frozenGetBlock = (
  blocks: Readonly<Uint8Array>,
  lx: number,
  y: number,
  lz: number,
  height: number
): number => {
  if (lx < 0 || lx >= CHUNK_SIZE || y < 0 || y >= height || lz < 0 || lz >= CHUNK_SIZE) {
    return AIR
  }
  return blocks[y + lz * height + lx * height * CHUNK_SIZE] ?? AIR
}

const frozenWalkArm = (blocks: Readonly<Uint8Array>) => (): void => {
  let total = 0
  for (const face of FACES) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          total += frozenGetBlock(blocks, lx + face.nx, y + face.ny, lz + face.nz, CHUNK_HEIGHT)
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
// Greedy merge quad reduction — a COUNT, and the headline number of this file
// ---------------------------------------------------------------------------

/**
 * What the merge removes, per fixture. EXACT, not measured.
 *
 * Same standing as the LOD table below and for the same reason: `meshChunk` and
 * `meshChunkNaive` are deterministic functions of deterministic fixtures, so
 * these counts are byte-identical on every machine and are not compared against
 * the baseline or given a tolerance. They are the reason the timings underneath
 * them are worth paying, and the reason greedy meshing was written at all.
 *
 * The `area` column is the check, not the result: it is the number of block
 * faces covered, and it must be IDENTICAL between the two meshers on every row.
 * A merge that lost a face would show a smaller quad count and a smaller area,
 * and without this column the first would read as a triumph.
 */
const percent = (after: number, before: number): string =>
  before === 0 ? '     -' : `${(100 * (1 - after / before)).toFixed(1).padStart(5)}%`

const printMergeTable = (): void => {
  console.log('greedy merge quad reduction — an exact COUNT over deterministic fixtures, not a timing:\n')
  console.log(
    `  ${'fixture'.padEnd(22)}${'naive'.padStart(9)}${'merged'.padStart(9)}${'removed'.padStart(9)}` +
      `${'area'.padStart(9)}${'area ok'.padStart(9)}   layers (merged)`,
  )
  for (const { name, chunk } of BENCH_FIXTURES) {
    const naive = meshChunkNaive(chunk, {}, CONFIG)
    const merged = meshChunk(chunk, {}, CONFIG)
    const naiveCount = totalQuadCount(naive)
    const mergedCount = totalQuadCount(merged)
    const areaOk = totalQuadArea(naive) === totalQuadArea(merged)
    console.log(
      `  ${name.padEnd(22)}${String(naiveCount).padStart(9)}${String(mergedCount).padStart(9)}` +
        `${percent(mergedCount, naiveCount).padStart(9)}${String(totalQuadArea(merged)).padStart(9)}` +
        `${(areaOk ? 'yes' : 'NO').padStart(9)}   ` +
        `${String(merged.opaque.length)} opaque + ${String(merged.water.length)} water + ` +
        `${String(merged.transparentSolid.length)} glass`,
    )
    if (!areaOk) {
      // Not a tolerance and not a warning. If this ever prints, the merge has
      // Lost or duplicated surface and the quad reduction on the same line is
      // Meaningless.
      console.error(
        `  ${''.padEnd(22)}AREA MISMATCH: naive ${String(totalQuadArea(naive))} vs merged ` +
          `${String(totalQuadArea(merged))} — the merge is not covering the same surface.`,
      )
    }
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// LOD quad reduction — a COUNT, and therefore not a benchmark
// ---------------------------------------------------------------------------

/** Every level that actually simplifies. LOD 0 is the identity by construction. */
const SIMPLIFIED_LEVELS: ReadonlyArray<LodLevel> = LOD_LEVELS.filter((level) => level !== 0)

/** Faces whose normal is +Y or -Y. The ones snapped on BOTH of their axes. */
const isVerticalNormal = (direction: string): boolean => direction === 'yPos' || direction === 'yNeg'

const splitByNormal = (layers: MeshLayers): { readonly caps: number; readonly sides: number } => {
  let caps = 0
  for (const quad of layers.opaque) {
    if (isVerticalNormal(quad.direction)) {
      caps += 1
    }
  }
  return { caps, sides: layers.opaque.length - caps }
}

/**
 * What simplification removes, per fixture and per level.
 *
 * THIS IS NOT A BENCHMARK AND IT IS NOT COMPARED AGAINST THE BASELINE. It is a
 * count of quads produced by a deterministic function over a deterministic
 * fixture: it has no clock in it, it is byte-identical on every machine, and it
 * is therefore exact rather than tolerated. It is printed here, next to the
 * timings, because it is the number that says whether the timings are worth
 * paying — and printing it anywhere else would let the two drift apart.
 *
 * The caps/sides split is the point of the table rather than a detail of it.
 * Top and bottom faces are snapped on both axes and collapse by step^2; side
 * faces are snapped on one, because the other is Y and Y is never snapped, and
 * collapse by step. A mesh is therefore reduced in proportion to how much of it
 * faces up. See docs/design-notes.md M-8.
 */
const printReductionTable = (
  label: string,
  meshed: ReadonlyArray<{ readonly name: string; readonly layers: MeshLayers }>,
): void => {
  console.log(`LOD quad reduction, ${label} — an exact COUNT over deterministic fixtures, not a timing:\n`)
  console.log(
    `  ${'fixture'.padEnd(22)}${'level'.padStart(5)}${'opaque'.padStart(9)}` +
      `${'removed'.padStart(9)}${'caps'.padStart(8)}${'sides'.padStart(8)}   other layers`,
  )
  for (const { name, layers } of meshed) {
    const full = splitByNormal(layers)
    const untouched = `${String(layers.water.length)} water + ${String(layers.transparentSolid.length)} glass`
    const row = (level: number, current: MeshLayers): string => {
      const split = splitByNormal(current)
      return (
        `  ${name.padEnd(22)}${String(level).padStart(5)}${String(current.opaque.length).padStart(9)}` +
        `${level === 0 ? '        -' : percent(current.opaque.length, layers.opaque.length).padStart(9)}` +
        `${String(split.caps).padStart(8)}${String(split.sides).padStart(8)}   ${untouched}`
      )
    }
    console.log(row(0, layers))
    for (const level of SIMPLIFIED_LEVELS) {
      console.log(row(level, simplifyMesh(layers, level)))
    }
    console.log(
      `  ${''.padEnd(22)}${'caps'.padStart(5)} ${String(full.caps).padStart(8)}` +
        `  sides ${String(full.sides).padStart(7)}   (LOD 0 split, for the ratios above)`,
    )
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const options = (iterations: number, warmupIterations = iterations): MeasureOptions => ({
  iterations,
  runs: RUNS,
  warmupIterations,
})

const main = async (): Promise<number> => {
  const tolerances = tolerancesFrom(process.argv)
  const rolling = ROLLING

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
      // Own current shape. Expected ~1.0; it drops if `getBlock` gets slower,
      // Whatever the reason.
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
      fastLabel: 'native Set.has',
      fastMs: nativeMs,
      name: 'set-membership/hashset-vs-native-set',
      regression: 'meshing-transparency-sets-are-native',
      slowLabel: 'Effect HashSet.has',
      slowMs: hashMs,
    },
    {
      fastLabel: 'Uint8Array lookup',
      fastMs: lookupMs,
      name: 'set-membership/native-set-vs-lookup-table',
      regression: 'meshing-transparency-sets-are-native',
      slowLabel: 'native Set.has',
      slowMs: nativeMs,
    },
    {
      fastLabel: 'getBlock -> number',
      fastMs: plainMs,
      name: 'neighbour-read/option-vs-plain-number',
      regression: 'meshing-get-block-is-allocation-free',
      slowLabel: 'getBlock -> Option',
      slowMs: optionMs,
    },
  ]

  console.log('performance exceptions (plan.md §5.2) as A/B ratios — machine-independent:\n')
  for (const guard of guards) {
    console.log(formatGuard(guard))
    console.log(`  ${' '.repeat(4)}protects docs/design-notes.md regression: ${guard.regression}\n`)
  }

  // Deliberately more iterations than any other case: the yardstick divides
  // Every workload figure, so its noise is every workload's noise.
  const yardstickMs = measure(yardstickOver(rolling.blocks), options(200, 400))

  const meshWorkloads: ReadonlyArray<Workload> = BENCH_FIXTURES.map(({ name, chunk }) => {
    const msPerUnit = measure(() => {
      sink += meshChunk(chunk, {}, CONFIG).opaque.length
    }, options(60))
    return {
      detail: `${String(totalQuadCount(meshChunk(chunk, {}, CONFIG)))} quads`,
      msPerUnit,
      name: `meshChunk/${name}`,
      unit: 'chunk',
    }
  })

  const scratchMeasurements = BENCH_FIXTURES.map(({ name, chunk }) => {
    const coldMs = measure(() => {
      sink += meshChunk(chunk, {}, CONFIG).opaque.length
    }, options(60))
    const scratch = createMeshScratch()
    meshChunk(chunk, {}, CONFIG, scratch)
    const reusedMs = measure(() => {
      sink += meshChunk(chunk, {}, CONFIG, scratch).opaque.length
    }, options(60))
    return { coldMs, name, reusedMs }
  })

  /**
   * The naive mesher, timed on the same fixtures.
   *
   * Here so that the TIME side of the greedy merge's trade is on the record next
   * to the quad side, and gated the same way. Greedy meshing buys triangles with
   * work: it builds a mask, then sweeps it, where the naive pass just emits. On
   * terrain with long flat runs the mask pays for itself many times over; on
   * checkerboard there is nothing to merge and the sweep is pure overhead, so
   * `meshChunk` is expected to be SLOWER than `meshChunkNaive` there. That is not
   * a regression and the baseline records both numbers so that it cannot be
   * mistaken for one later.
   */
  const naiveWorkloads: ReadonlyArray<Workload> = BENCH_FIXTURES.map(({ name, chunk }) => {
    const msPerUnit = measure(() => {
      sink += meshChunkNaive(chunk, {}, CONFIG).opaque.length
    }, options(60))
    return {
      detail: `${String(totalQuadCount(meshChunkNaive(chunk, {}, CONFIG)))} quads (the oracle, not shipped)`,
      msPerUnit,
      name: `meshChunkNaive/${name}`,
      unit: 'chunk',
    }
  })

  // Meshed once, outside the timed loop: this measures simplification, not
  // Meshing, and the two differ by more than an order of magnitude.
  const meshedFixtures = BENCH_FIXTURES.map(({ name, chunk }) => ({
    layers: meshChunk(chunk, {}, CONFIG),
    name,
  }))

  const simplifyWorkloads: ReadonlyArray<Workload> = meshedFixtures.flatMap(({ name, layers }) =>
    SIMPLIFIED_LEVELS.map((level) => {
      const msPerUnit = measure(() => {
        sink += simplifyMesh(layers, level).opaque.length
      }, options(200, 400))
      const after = simplifyMesh(layers, level)
      return {
        detail: `${String(layers.opaque.length)} -> ${String(after.opaque.length)} opaque quads`,
        msPerUnit,
        name: `simplifyMesh/lod${String(level)}/${name}`,
        unit: 'chunk',
      }
    }),
  )

  /**
   * The fluid surface pass, on its own fixture and its own config.
   *
   * ONE workload rather than a fifth column in every table above, because fluid
   * meshing is priced by how much FLUID there is and the other four shapes have
   * none. Folding a lake into `BENCH_FIXTURES` would have moved every recorded
   * figure in docs/design-notes.md M-8, M-9 and M-10 for no measurement anyone
   * asked for.
   *
   * `LAKE` is meshed under `FLUID_CONFIG`, so its water is variable-height
   * geometry rather than cubes — the comparison worth having is against the same
   * chunk under `CONFIG`, where the identical bytes mesh as cubes, and both are
   * printed so the difference is on the record rather than inferred.
   */
  const fluidWorkloads: ReadonlyArray<Workload> = [
    {
      detail:
        `${String(meshChunk(LAKE, {}, FLUID_CONFIG).fluids.length)} fluid faces + ` +
        `${String(totalQuadCount(meshChunk(LAKE, {}, FLUID_CONFIG)))} quads`,
      msPerUnit: measure(() => {
        sink += meshChunk(LAKE, {}, FLUID_CONFIG).fluids.length
      }, options(60)),
      name: 'meshChunk/lake-fluid',
      unit: 'chunk',
    },
    {
      detail: `${String(totalQuadCount(meshChunk(LAKE, {}, CONFIG)))} quads (same chunk, fluid table absent)`,
      msPerUnit: measure(() => {
        sink += meshChunk(LAKE, {}, CONFIG).water.length
      }, options(60)),
      name: 'meshChunk/lake-as-cubes',
      unit: 'chunk',
    },
  ]

  const workloads: ReadonlyArray<Workload> = [
    ...meshWorkloads,
    ...naiveWorkloads,
    ...simplifyWorkloads,
    ...fluidWorkloads,
  ]

  console.log('end-to-end workloads — absolute figures are indicative only (see harness header):\n')
  console.log(`  ${'yardstick/six-linear-byte-passes'.padEnd(44)} ${yardstickMs.toFixed(4)} ms/pass`)
  for (const workload of workloads) {
    console.log(formatWorkload(workload))
  }
  console.log('')

  console.log('meshChunk scratch reuse — indicative cold versus same-caller workspace:\n')
  for (const measurement of scratchMeasurements) {
    const ratio = measurement.reusedMs / measurement.coldMs
    console.log(
      `  ${`meshChunk/${measurement.name}`.padEnd(44)} ` +
        `${measurement.coldMs.toFixed(4)} -> ${measurement.reusedMs.toFixed(4)} ms/chunk ` +
        `(${ratio.toFixed(3)}x)`,
    )
  }
  console.log('')

  printMergeTable()

  // Both tables, and the pair is the finding. The first is what mc-render
  // Actually gets — LOD applied to the merged mesh it will be handed — and the
  // Second is what docs/design-notes.md M-8 measured before the merge existed.
  // Docs/responsibility.md §3.5(c) asked for exactly this comparison, on the
  // Grounds that if LOD 1 stops buying anything once merging lands then the
  // 4-chunk threshold is paying an ~11px silhouette error for nothing.
  printReductionTable('on the MERGED mesh (what mc-render is handed)', meshedFixtures)
  printReductionTable(
    'on the NAIVE mesh (what M-8 originally measured)',
    BENCH_FIXTURES.map(({ name, chunk }) => ({ layers: meshChunkNaive(chunk, {}, CONFIG), name })),
  )

  if (wantsBaselineUpdate(process.argv)) {
    const recorded: Baseline = {
      guards: Object.fromEntries(guards.map((guard) => [guard.name, Number(guardRatio(guard).toPrecision(4))])),
      note:
        'guards are slow/fast A/B ratios measured in one process and are machine-independent; ' +
        'workloads are workload/yardstick ratios and are only approximately so. ' +
        'Regenerate with `pnpm bench --update-baseline` and say in the commit message what moved and why.',
      recordedOn: process.env['BENCH_MACHINE'] ?? 'unrecorded machine',
      version: 1,
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
