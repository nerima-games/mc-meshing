/**
 * The timeout every FastCheck property in this repository runs under, and the
 * measurement behind the number.
 *
 * NOT A TEST — a constant the property tests share, so that the next one written
 * inherits the reasoning instead of rediscovering it the hard way.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 *
 * The same defect has now happened twice here, and both times it had the worst
 * possible shape: GREEN FOR THE AUTHOR, RED FOR EVERYONE ELSE.
 *
 * A property that meshes a chunk many times is genuinely several seconds of
 * work, and v8's coverage instrumentation multiplies it. Measured on this
 * repository:
 *
 *     pnpm vitest run test/mesh.test.ts                4.19 s
 *     pnpm vitest run --coverage test/mesh.test.ts    14.48 s     -> 3.5x
 *
 *     pnpm vitest run --coverage test/plant-mesh.test.ts  7.90 s  -> under the
 *                                                                    10 s default
 *                                                                    ON THIS BOX
 *
 * CI runs the coverage variant on a slower machine than the one those numbers
 * came from. So a property that finishes in 7.9 s here is over the limit there,
 * and the author has no local signal at all. `test/mesh.test.ts` learned this
 * first and kept the constant privately; `test/plant-mesh.test.ts` was written
 * afterwards, did not inherit it, and failed CI on its first run.
 *
 * ---------------------------------------------------------------------------
 * Why the answer is a bigger timeout and NOT fewer runs
 * ---------------------------------------------------------------------------
 *
 * Cutting `numRuns` fixes the symptom in one line and is the wrong trade. These
 * properties are what make it legitimate that greedy merging was allowed to move
 * the emission order and the recorded baselines: the argument holding those up
 * is "the merged output tiles exactly the same surface", and that argument is
 * only as strong as the number of chunks it was checked against.
 *
 * Trading it for a few seconds would leave a green suite standing behind a
 * weaker claim than the one the documentation makes -- which is worse than a
 * slow test and much harder to notice.
 */
export const PROPERTY_TIMEOUT_MS = 40_000
