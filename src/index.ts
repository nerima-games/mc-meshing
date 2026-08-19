/**
 * @nerima-games/mc-meshing — chunk or parsed resource-pack data to geometry, as pure functions.
 *
 * This 0.x library accepts block ids plus an injected `MeshConfig` and returns
 * greedy cube-face layers together with separate cross-plant, fluid, and
 * mc-kernel special-shape collections. Parsed resource-pack blockstates and
 * models can enter through `ResourcePackAssets` and leave as model quads. It
 * is intentionally independent of Three.js, WebGL, the DOM, services, and
 * I/O — the same pure code runs in a worker in production and under plain Node
 * in tests.
 *
 * Two things here are performance exceptions established by measurement in the
 * reference implementation and carried over verbatim (plan.md §5.2). Read
 * domain/opacity.ts and domain/chunk-view.ts before changing either:
 *
 *   - the transparency sets are native `Set`, never Effect `HashSet`
 *   - `getBlock` inlines its bounds checks and never allocates an `Option`
 */

export * from './domain/ambient-occlusion.js'
export * from './domain/block-data.js'
export * from './domain/chunk-view.js'
export * from './domain/kernel-adapter.js'
export * from './domain/faces.js'
export * from './domain/light-sampling.js'
export * from './domain/light-types.js'
export * from './domain/fluid-mesh.js'
export * from './domain/lod.js'
export * from './domain/mesh.js'
export * from './domain/mesh-buffers.js'
export * from './domain/mesh-scratch.js'
export * from './domain/opacity.js'
export * from './domain/plant-mesh.js'
export * from './domain/resource-pack-mesh.js'
export * from './domain/resource-pack-resolver.js'
export * from './domain/resource-pack-schema.js'
export * from './domain/resource-pack-types.js'
export * from './domain/rail-geometry.js'
export * from './domain/rail-types.js'
export * from './domain/special-mesh.js'
