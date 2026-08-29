/**
 * @nerima-games/mc-meshing — chunk data to geometry, as a pure function.
 *
 * A tier-1 stable library (plan.md §2.2). Input is block ids plus an injected
 * `MeshConfig`; output is three merged cube-face lists plus dedicated plant,
 * fluid, and special-geometry lists. No Three.js, no WebGL, no DOM, no
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

export * from './domain/ambient-occlusion.js'
export * from './domain/chunk-view.js'
export * from './domain/faces.js'
export * from './domain/fluid-mesh.js'
export * from './domain/kernel-mesh-config.js'
export * from './domain/lod.js'
export * from './domain/mesh.js'
export * from './domain/opacity.js'
export * from './domain/plant-mesh.js'
export * from './domain/special-mesh.js'
