/**
 * bench-harness.ts — measurement, medians, and baseline comparison.
 *
 * Ported from the reference implementation's `scripts/bench-meshing.ts`,
 * `bench-light.ts` and `bench-terrain.ts`, which were hand-rolled around
 * `node:perf_hooks` and never wired into CI or `package.json`. The methodology
 * is theirs and is deliberately not reinvented: **warm up, then take the median
 * of several timed runs**. The reference used 7 runs for meshing and 9 for
 * terrain; both counts are odd so the median is a real sample.
 *
 * ---------------------------------------------------------------------------
 * Why nothing here asserts a millisecond figure
 * ---------------------------------------------------------------------------
 *
 * An absolute "3.4 ms/chunk" baseline is worthless as a gate. It encodes the
 * machine that recorded it, so it either fails on every slower runner or passes
 * on every faster one. What is worth catching is *"this got 3x slower"*, and
 * that is a RATIO. Two kinds of ratio are used, and they are not equally strong:
 *
 *   GUARD (`guards` in the baseline) — an A/B ratio between two implementations
 *     of the same computation, measured in the SAME process, on the SAME data,
 *     within milliseconds of each other. The machine cancels out exactly. A
 *     guard is what protects a plan.md §5.2 performance exception: it measures
 *     the fast spelling against the idiomatic spelling that keeps getting
 *     proposed, and it fails when the gap closes. This is the strong number.
 *
 *   WORKLOAD (`workloads` in the baseline) — the real end-to-end cost, divided
 *     by a `yardstick` workload measured in the same run. The yardstick is a
 *     fixed, deterministic loop chosen to have a similar memory/ALU character
 *     to the thing being measured, so that a faster or slower machine moves
 *     both numbers together and the quotient stays put. This is the weaker
 *     number: no yardstick normalises perfectly across microarchitectures (a
 *     machine with more cache moves a memory-bound workload and an ALU-bound
 *     yardstick by different factors), so its tolerance is deliberately loose
 *     and it is documented as indicative, not authoritative.
 *
 * ---------------------------------------------------------------------------
 * `performance.now()` and the clock ban
 * ---------------------------------------------------------------------------
 *
 * `scripts/check-dependency-whitelist.ts` rule 7 bans `Date.now()`,
 * `new Date()` and `performance.now()` repository-wide, and it scans
 * `scripts/`. The ban exists so that *simulation* is deterministic and
 * replayable; a benchmark harness is the one other place that must read a real
 * clock, for the same reason a clock adapter must. The read is confined to the
 * single `now()` function below and carries the documented escape-hatch marker,
 * so `grep mc-kernel-allow-time-source` still enumerates every raw clock read
 * in the repository — which is the property the marker exists to preserve.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

/** The only raw clock read in this repository. See the header. */
const now = (): number => performance.now() // mc-kernel-allow-time-source: benchmark harness

/**
 * Chunks meshed on initial load at renderDistance=4, i.e. (2*4+1)^2.
 *
 * The reference's `bench-meshing.ts` and `bench-terrain.ts` both multiply their
 * per-chunk median by this to state a load-time budget, and that framing is
 * kept: a per-chunk figure is hard to feel, a load-time figure is not.
 */
export const CHUNKS_ON_LOAD = 81

export type MeasureOptions = {
  /** Calls of `run` per timed sample. Amortises timer resolution. */
  readonly iterations: number
  /** Calls of `run` before timing starts, to let the JIT settle. */
  readonly warmupIterations: number
  /** Timed samples to take. Odd, so the median is an actual observation. */
  readonly runs: number
}

export const median = (samples: ReadonlyArray<number>): number => {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

/**
 * Median milliseconds per call of `run`.
 *
 * Exactly the reference's shape: warm up, then `runs` timed batches of
 * `iterations` calls each, then the median of the per-call averages. The median
 * rather than the mean because a single GC pause or a scheduler preemption
 * inside one batch would otherwise move the answer.
 */
export const measure = (run: () => void, options: MeasureOptions): number => {
  for (let index = 0; index < options.warmupIterations; index += 1) {
    run()
  }

  const samples: Array<number> = []
  for (let sample = 0; sample < options.runs; sample += 1) {
    const started = now()
    for (let index = 0; index < options.iterations; index += 1) {
      run()
    }
    samples.push((now() - started) / options.iterations)
  }

  return median(samples)
}

/**
 * A measured A/B pair protecting one documented performance exception.
 *
 * `fast` is the spelling the repository uses. `slow` is the spelling that gets
 * proposed in review. `ratio` is `slow / fast` and is what the baseline pins.
 */
export type Guard = {
  readonly name: string
  /** The regression test name in docs/design-notes.md that this backs. */
  readonly regression: string
  readonly fastLabel: string
  readonly slowLabel: string
  readonly fastMs: number
  readonly slowMs: number
  /**
   * Overrides `DEFAULT_GUARD_TOLERANCE` for this guard alone.
   *
   * Used by the shipped-vs-frozen gates, which compare a function against a
   * copy of itself and so are far quieter than the price-list guards (5-6%
   * spread against up to 17%). A quieter measurement can afford — and should
   * carry — a tighter threshold, because it is the one that has to fire.
   */
  readonly tolerance?: number | undefined
}

export const guardRatio = (guard: Guard): number => guard.slowMs / guard.fastMs

export type Workload = {
  readonly name: string
  readonly msPerUnit: number
  /** Free-text description of one unit, e.g. `chunk`. */
  readonly unit: string
  /** Extra context printed after the timing, e.g. a quad count. */
  readonly detail?: string
}

export type Baseline = {
  readonly version: 1
  readonly recordedOn: string
  readonly note: string
  /** `slow / fast` ratios. Observed must not fall far BELOW these. */
  readonly guards: Readonly<Record<string, number>>
  /** `workload / yardstick` ratios. Observed must not rise far ABOVE these. */
  readonly workloads: Readonly<Record<string, number>>
}

/**
 * How far a ratio may drift before the run fails. Guards and workloads get
 * different numbers, because they are different kinds of measurement.
 *
 * GUARDS are process-internal A/B pairs over identical data, so their noise is
 * small: measured spread across five whole-benchmark reruns is 5-6% for each
 * repository's primary shipped-vs-frozen gate and at worst 17% for the
 * comparative price-list guards. 1.3 means a guard fails when its ratio falls to
 * 77% of baseline, which is roughly four times the worst observed noise and
 * still tight enough to catch the CHEAPEST rewrite either repository documents
 * (`effect`'s `Array.reduce`, measured at 1.31x the imperative octave loop —
 * swapping it in drops that gate to 0.64 of baseline, comfortably outside 0.77).
 *
 * WORKLOADS are divided by a yardstick that only approximates the workload's
 * memory/ALU mix, so they carry real cross-machine error on top of run-to-run
 * noise. 2.0 is the "this got 3x slower" gate the task actually wants; anything
 * tighter turns into a flake on a shared CI runner, and a benchmark that cries
 * wolf gets deleted.
 *
 * ---------------------------------------------------------------------------
 * WHAT A WALL-CLOCK GATE CANNOT DO
 * ---------------------------------------------------------------------------
 *
 * A rewrite that costs less than the tolerance slips through, and no choice of
 * threshold removes that — it only moves the line. Timing is a coarse
 * instrument: it catches "this got much slower", not "this is written the wrong
 * way". Spelling-level invariants belong to the type system and to the named
 * regression tests in docs/design-notes.md. This file prices them; it does not
 * replace them, and neither should be deleted in favour of the other.
 */
export const DEFAULT_GUARD_TOLERANCE = 1.3
export const DEFAULT_WORKLOAD_TOLERANCE = 2

/**
 * Tolerance for the shipped-vs-frozen gates specifically (`Guard.tolerance`).
 *
 * Those compare a shipped function against a frozen copy of its own current
 * shape, so their spread is 5-6% where the price-list guards reach 17%. 1.15
 * gives them a threshold of 0.87 of baseline against ~2.5% worst-case observed
 * drift, and it is what makes the cheapest documented rewrite fail: fold-ifying
 * `octaveNoise2D` with `effect`'s `Array.reduce` puts that gate at 0.79 of
 * baseline, which passes at 1.3 and fails at 1.15.
 */
export const SHIPPED_VS_FROZEN_TOLERANCE = 1.15

export type CheckResult = {
  readonly label: string
  readonly kind: 'guard' | 'workload'
  readonly observed: number
  readonly baseline: number | undefined
  readonly status: 'ok' | 'regressed' | 'new'
}

export const checkGuards = (
  guards: ReadonlyArray<Guard>,
  baseline: Baseline | undefined,
  tolerance: number,
): ReadonlyArray<CheckResult> =>
  guards.map((guard) => {
    const observed = guardRatio(guard)
    const recorded = baseline?.guards[guard.name]
    const applied = guard.tolerance ?? tolerance
    if (recorded === undefined) {
      return { label: guard.name, kind: 'guard' as const, observed, baseline: undefined, status: 'new' as const }
    }
    return {
      label: guard.name,
      kind: 'guard' as const,
      observed,
      baseline: recorded,
      status: observed >= recorded / applied ? ('ok' as const) : ('regressed' as const),
    }
  })

export const checkWorkloads = (
  workloads: ReadonlyArray<Workload>,
  yardstickMs: number,
  baseline: Baseline | undefined,
  tolerance: number,
): ReadonlyArray<CheckResult> =>
  workloads.map((workload) => {
    const observed = workload.msPerUnit / yardstickMs
    const recorded = baseline?.workloads[workload.name]
    if (recorded === undefined) {
      return { label: workload.name, kind: 'workload' as const, observed, baseline: undefined, status: 'new' as const }
    }
    return {
      label: workload.name,
      kind: 'workload' as const,
      observed,
      baseline: recorded,
      status: observed <= recorded * tolerance ? ('ok' as const) : ('regressed' as const),
    }
  })

export const readBaseline = async (filePath: string): Promise<Baseline | undefined> => {
  const raw = await readFile(filePath, 'utf8').catch(() => undefined)
  return raw === undefined ? undefined : (JSON.parse(raw) as Baseline)
}

export const writeBaseline = async (filePath: string, baseline: Baseline): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(baseline, undefined, 2)}\n`, 'utf8')
}

const pad = (text: string, width: number): string => text.padEnd(width)

export const formatGuard = (guard: Guard): string =>
  `  ${pad(guard.name, 52)} ${guardRatio(guard).toFixed(2)}x` +
  `   [${pad(guard.fastLabel, 22)} ${guard.fastMs.toFixed(4)} ms` +
  `  vs  ${pad(guard.slowLabel, 22)} ${guard.slowMs.toFixed(4)} ms]`

/**
 * The x81 load-time framing is only meaningful for a per-chunk cost, so it is
 * printed for `unit === 'chunk'` and suppressed for anything else (a per-seed
 * one-time cost multiplied by 81 would be a lie).
 */
export const formatWorkload = (workload: Workload): string =>
  `  ${pad(workload.name, 44)} ${workload.msPerUnit.toFixed(4)} ms/${workload.unit}` +
  (workload.unit === 'chunk'
    ? `   x${String(CHUNKS_ON_LOAD)} = ${(workload.msPerUnit * CHUNKS_ON_LOAD).toFixed(1)} ms`
    : '') +
  (workload.detail === undefined ? '' : `   (${workload.detail})`)

export const formatCheck = (result: CheckResult): string => {
  const marker = result.status === 'ok' ? 'ok       ' : result.status === 'new' ? 'NEW      ' : 'REGRESSED'
  const against =
    result.baseline === undefined
      ? 'no baseline entry — run with --update-baseline to record it'
      : `observed ${result.observed.toFixed(3)}  baseline ${result.baseline.toFixed(3)}` +
        `  (${(result.observed / result.baseline).toFixed(2)}x baseline)`
  return `  ${marker}  ${pad(result.label, 44)} ${against}`
}

/** `--update-baseline` rewrites the committed file instead of checking it. */
export const wantsBaselineUpdate = (argv: ReadonlyArray<string>): boolean =>
  argv.includes('--update-baseline')

const numericFlag = (argv: ReadonlyArray<string>, name: string, fallback: number): number => {
  const prefix = `--${name}=`
  const flag = argv.find((argument) => argument.startsWith(prefix))
  const parsed = flag === undefined ? Number.NaN : Number.parseFloat(flag.slice(prefix.length))
  return Number.isFinite(parsed) && parsed > 1 ? parsed : fallback
}

/** `--guard-tolerance=1.2` / `--workload-tolerance=3` override the defaults. */
export const tolerancesFrom = (
  argv: ReadonlyArray<string>,
): { readonly guard: number; readonly workload: number } => ({
  guard: numericFlag(argv, 'guard-tolerance', DEFAULT_GUARD_TOLERANCE),
  workload: numericFlag(argv, 'workload-tolerance', DEFAULT_WORKLOAD_TOLERANCE),
})
