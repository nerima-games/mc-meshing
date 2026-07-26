/**
 * @nerima-games/mc-meshing — chunk data to geometry, as a pure function.
 *
 * FIRST CUT (叩き台). See README.md 現状.
 *
 * A tier-1 stable library (plan.md §2.2). Input is block ids plus an injected
 * `MeshConfig`; output is three face lists. No Three.js, no WebGL, no DOM, no
 * services, no I/O — meshing runs in a worker in production and under plain
 * Node in tests, and the same code must serve both.
 *
 * Two things here are performance exceptions established by measurement in the
 * reference implementation and carried over verbatim (plan.md §5.2). Read
 * domain/opacity.ts and domain/chunk-view.ts before changing either:
 *
 *   - the transparency sets are native `Set`, never Effect `HashSet`
 *   - `getBlock` inlines its bounds checks and never allocates an `Option`
 */

export * from './domain/chunk-view'
export * from './domain/faces'
export * from './domain/mesh'
export * from './domain/opacity'
