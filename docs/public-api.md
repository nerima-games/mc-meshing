# Public API

The package entry point re-exports the public domain APIs from `src/index.ts`.

## Chunk input and results

`ChunkView` adapts the kernel chunk data to the mesher's element-array layout. The block array uses `Uint16Array`, which has the same numeric range as kernel `BlockId`.

```ts
import { Result } from 'effect'
import { blockCount, meshChunk, type ChunkView } from '@nerima-games/mc-meshing'

// The caller supplies kernelChunk, neighbours, config, and consumeLayers.
const meshKernelChunk = () => {
  const count = blockCount(kernelChunk.height)
  if (Result.isFailure(count)) {
    return count
  }

  const blocks = new Uint16Array(count.success)
  kernelChunk.blocks.copyTo(blocks)
  const view: ChunkView = {
    coord: kernelChunk.coord,
    height: kernelChunk.height,
    blocks,
  }

  const result = meshChunk(view, neighbours, config)
  if (Result.isFailure(result)) {
    return result
  }
  consumeLayers(result.success)
  return Result.succeed(undefined)
}
```

`blockCount`, `blockCountOf`, and `emptyChunk` return Effect 4 `Result` values because the requested height can be invalid. Check the result before reading `success`. Chunk coordinates are kernel `ChunkCoord` values; this package does not define another coordinate brand.

`ChunkView.blocks` is indexed in X, Z, Y order:

```ts
blockIndex(lx, y, lz, height) = y + lz * height + lx * height * CHUNK_SIZE
```

`getBlock` and `getBlockAcrossBoundary` return kernel `BlockId` values. An out-of-range chunk-local read returns `AIR`. Values read from `Uint16Array` already fit the kernel's numeric `BlockId` range; the hot read path does not allocate a `Result` or revalidate every cell. Callers must validate raw numeric IDs before narrowing them into typed-array storage.

Optional `fluid`, `railShapes`, and `light` sidecars provide decoded per-cell state. A present `FluidView` must have `levels`, `sources`, and `falling` arrays that cover every cell in its chunk; `meshChunk`, `meshChunkNaive`, `meshChunkRegion`, and `meshFluidSurfaces` return an `IncompleteFluidView` failure for a shorter array. An absent fluid sidecar retains the full-height, non-source compatibility behavior. Light fields use kernel `LightLevel`; propagation and grid construction remain the caller's responsibility.

## Mesh configuration and block IDs

```ts
import type { BlockId } from '@nerima-games/mc-kernel'

export type MeshConfig = {
  readonly waterBlockIds: ReadonlySet<BlockId>
  readonly transparentSolidBlockIds: ReadonlySet<BlockId>
  readonly crossPlantBlockIds: ReadonlySet<BlockId>
  readonly fluidMaxLevels: ReadonlyMap<BlockId, number>
}

export const EMPTY_MESH_CONFIG: MeshConfig
export const MINECRAFT_MESH_CONFIG: Result.Result<MeshConfig, MeshConfigFailure>
export const MAX_BLOCK_ID: number // re-export of kernel BLOCK_ID_MAX

export const layerOfBlockId: (config: MeshConfig, blockId: BlockId) => MeshLayer
export const buildLayerLookup: (config: MeshConfig) => Result.Result<Uint8Array, LayerLookupFailure>
export const buildFluidLookup: (config: MeshConfig) => Result.Result<Uint16Array, FluidLookupFailure>
export const buildCrossPlantLookup: (config: MeshConfig) => Result.Result<Uint8Array, CrossPlantLookupFailure>
```

Configuration collections use native `Set` and `Map` with kernel `BlockId` keys. The collections are caller-owned and must not be mutated after their first use by a mesher. Create new collections and a new `MeshConfig` when changing block classification; lookup tables are cached by `MeshConfig` object identity.

Use the kernel's validating `BlockId.result(value)` or `BlockId.option(value)` API at an untrusted numeric boundary. Calling the brand constructor directly is the throwing form. Fluid maximum levels must be integers from `0` through `255`; invalid IDs or levels are reported through `Result` failures.

`waterBlockIds` and `transparentSolidBlockIds` classify cube faces into the three mesh layers. `crossPlantBlockIds` selects a dedicated cross-plant shape, while `fluidMaxLevels` supplies the level ceiling for configured fluid blocks.

## Faces and mesh layers

```ts
export type MeshLayer = 'opaque' | 'water' | 'transparentSolid'
export const MESH_LAYER_PRIORITY: ReadonlyArray<MeshLayer> // transparentSolid, water, opaque
export const MESH_LAYERS: ReadonlyArray<MeshLayer> // opaque, water, transparentSolid

export type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg'
export type FaceRole = 'top' | 'bottom' | 'side'
export type FacePlacementFor<Direction extends FaceDirection> =
  Direction extends 'xPos' ? { readonly direction: 'xPos'; readonly role: 'side' }
  : Direction extends 'xNeg' ? { readonly direction: 'xNeg'; readonly role: 'side' }
  : Direction extends 'yPos' ? { readonly direction: 'yPos'; readonly role: 'top' }
  : Direction extends 'yNeg' ? { readonly direction: 'yNeg'; readonly role: 'bottom' }
  : Direction extends 'zPos' ? { readonly direction: 'zPos'; readonly role: 'side' }
  : { readonly direction: 'zNeg'; readonly role: 'side' }
export type FacePlacement = FacePlacementFor<FaceDirection>
export type FaceFor<Direction extends FaceDirection> = FacePlacementFor<Direction> &
  (Direction extends 'xPos' ? { readonly nx: 1; readonly ny: 0; readonly nz: 0 }
  : Direction extends 'xNeg' ? { readonly nx: -1; readonly ny: 0; readonly nz: 0 }
  : Direction extends 'yPos' ? { readonly nx: 0; readonly ny: 1; readonly nz: 0 }
  : Direction extends 'yNeg' ? { readonly nx: 0; readonly ny: -1; readonly nz: 0 }
  : Direction extends 'zPos' ? { readonly nx: 0; readonly ny: 0; readonly nz: 1 }
  : { readonly nx: 0; readonly ny: 0; readonly nz: -1 })
export type Face = FaceFor<FaceDirection>
export type TangentAxesFor<Direction extends FaceDirection> =
  Direction extends 'xPos' | 'xNeg' ? readonly ['y', 'z']
  : Direction extends 'yPos' | 'yNeg' ? readonly ['x', 'z']
  : readonly ['x', 'y']
export type OppositeDirectionFor<Direction extends FaceDirection> =
  Direction extends 'xPos' ? 'xNeg'
  : Direction extends 'xNeg' ? 'xPos'
  : Direction extends 'yPos' ? 'yNeg'
  : Direction extends 'yNeg' ? 'yPos'
  : Direction extends 'zPos' ? 'zNeg'
  : 'zPos'
export const FACES: ReadonlyArray<Face>
export const faceOf: <Direction extends FaceDirection>(direction: Direction) => FaceFor<Direction>
export const oppositeDirection: <Direction extends FaceDirection>(direction: Direction) => OppositeDirectionFor<Direction>
export const tangentAxes: <Direction extends FaceDirection>(direction: Direction) => TangentAxesFor<Direction>
```

The canonical face order is `+X, -X, +Y, -Y, +Z, -Z`. Face direction, normal, and role are correlated in the literal types. This order and the winding of generated vertices are part of the geometry contract.

`MeshLayers` owns separate arrays for cube faces, cross plants, special blocks, and fluids:

```ts
export type MeshLayers = {
  readonly opaque: ReadonlyArray<Quad>
  readonly water: ReadonlyArray<Quad>
  readonly transparentSolid: ReadonlyArray<Quad>
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly specialBlocks: ReadonlyArray<SpecialBlockQuad>
  readonly fluids: ReadonlyArray<FluidQuad>
}
```

The greedy mesher merges coplanar opaque cube faces that share direction, block ID, AO, and corner light. Transparent cube faces remain unit-sized. `meshChunkNaive` is the unmerged oracle; `meshChunkRegion` emits geometry owned by a dirty half-open region. Its halo is used only for visibility, AO, and fluid reads, and never owns output cells.

```ts
export const meshChunk: (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  scratch?: MeshScratch,
) => Result.Result<MeshLayers, LayerLookupFailure | LayerLookupTableFailure | FluidLookupFailure | CrossPlantLookupFailure | SpecialMeshFailure | MeshScratchFailure | GreedyMaskFailure>

export const meshChunkNaive: (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
) => Result.Result<MeshLayers, LayerLookupFailure | LayerLookupTableFailure | FluidLookupFailure | CrossPlantLookupFailure | SpecialMeshFailure>

export const meshChunkRegion: (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  dirtyRegion: MeshRegion,
) => Result.Result<RegionMesh, LayerLookupFailure | LayerLookupTableFailure | FluidLookupFailure | CrossPlantLookupFailure | SpecialMeshFailure | GreedyMaskFailure>

export class MeshScratch {
  static create(): MeshScratch
}
export const createMeshScratch: () => MeshScratch

export type MeshRegion = {
  readonly min: readonly [lx: number, y: number, lz: number]
  readonly max: readonly [lx: number, y: number, lz: number]
}
export type RegionMesh = {
  readonly dirtyRegion: MeshRegion
  readonly ownedRegion: MeshRegion
  readonly layers: MeshLayers
}
```

All three chunk meshing entry points return `Result`. They report incomplete fluid sidecars, invalid lookup configuration, kernel registry failures, and meshing failures to the caller. The standalone `meshFluidSurfaces` helper also returns `Result` and reports incomplete sidecars. `createMeshScratch()` creates a scratch instance that reuses mask and light work arrays across sequential calls; do not share one scratch instance between concurrent calls. Returned arrays and quads remain owned by each result and are not changed by later calls. `MeshRegion.min` is inclusive and `MeshRegion.max` is exclusive, in local X, Y, Z order.

`totalQuadCount` counts cube quads and `totalQuadArea` counts their area before merging. Fluid and special-shape quads are separate.

## Packed mesh buffers

```ts
export type PackedMeshBuffers = {
  readonly positions: Float32Array
  readonly normals: Int8Array
  readonly blockIds: Uint16Array
  readonly ao: Uint8Array
  readonly blockLight: Uint8Array
  readonly skyLight: Uint8Array
  readonly indices: Uint32Array
  readonly groups: ReadonlyArray<MeshBufferGroup>
}

export const packMeshLayers: (layers: MeshLayers) => PackedMeshBuffers
```

`packMeshLayers` converts cube, cross-plant, fluid, and special-block quads into owned typed arrays in a stable layer order. It produces uploadable geometry data but does not own a WebGL context, GPU device, texture, or material.

## Resource-pack JSON

`ResourcePackAssetsSchema` validates the supported JSON subset. The parsers accept unknown JSON-compatible values or a JSON string and return failures as data. They do not discover assets from a zip or filesystem and do not load PNG files.

```ts
import { Result, Schema, SchemaIssue } from 'effect'

export type ResourcePackAssets = {
  readonly blockstates: Readonly<Record<string, BlockStateDefinition>>
  readonly models: Readonly<Record<string, BlockModel>>
}

export const ResourcePackAssetsSchema: Schema.Schema<ResourcePackAssets>
export type ResourcePackParseInput = 'object' | 'json'
export type ResourcePackParseFailure = {
  readonly _tag: 'ResourcePackParseFailure'
  readonly input: ResourcePackParseInput
  readonly issue: SchemaIssue.Issue
  readonly message: string
}

export const parseResourcePackAssets: (
  value: unknown,
) => Result.Result<ResourcePackAssets, ResourcePackParseFailure>
export const parseResourcePackAssetsJson: (
  value: string,
) => Result.Result<ResourcePackAssets, ResourcePackParseFailure>
```

Normalized asset names use separate brands. The JSON-facing fields and asset record keys remain plain strings; normalization validates and converts them at the resolver boundary.

```ts
import { Result } from 'effect'
import type { Brand } from 'effect'

export type ResourceName = Brand.Branded<string, 'ResourceName'>
export type ModelName = Brand.Branded<string, 'ModelName'>
export type TextureName = Brand.Branded<string, 'TextureName'>

export function normalizeResourceName(name: string, kind: 'blockstate'):
  Result.Result<ResourceName, ResourcePackResolutionFailure>
export function normalizeResourceName(name: string, kind: 'model'):
  Result.Result<ModelName, ResourcePackResolutionFailure>

export const resolveBlockStateModels: (
  name: ResourceName,
  properties: BlockStateProperties,
  assets: ResourcePackAssets,
  options?: BlockStateResolveOptions,
) => Result.Result<ReadonlyArray<ResolvedBlockStateModel>, ResourcePackResolutionFailure>

export const resolveBlockModel: (
  name: ModelName,
  assets: ResourcePackAssets,
) => Result.Result<ResolvedBlockModel, ResourcePackResolutionFailure>

export const resolveModelTexture: (
  model: ResolvedBlockModel,
  reference: string,
) => Result.Result<TextureName, ResourcePackResolutionFailure>

export const meshBlockModel: (
  name: ModelName,
  assets: ResourcePackAssets,
  transform?: ResourceModelTransform,
) => Result.Result<ReadonlyArray<ResourceModelQuad>, ResourcePackResolutionFailure | ResourceModelMeshFailure>

export const meshBlockState: (
  name: ResourceName,
  properties: BlockStateProperties,
  assets: ResourcePackAssets,
  options?: BlockStateResolveOptions,
) => Result.Result<ReadonlyArray<ResourceModelQuad>, ResourcePackResolutionFailure | ResourceModelMeshFailure>
```

Resolved blockstate selections and model quads carry `ModelName`; resolved model quads carry `TextureName`. Texture references in raw model faces remain strings because values such as `#side` must be resolved through the model's texture map.

The supported subset includes variants, multipart OR/AND conditions, weighted selection, parent models, texture variables, ambient occlusion, block and element rotation, UVs, UV lock, cull faces, and tint indices. Element rotation accepts the legacy `axis`/`angle` form and the multi-axis `x`/`y`/`z` form; multi-axis rotations are applied X, then Y, then Z. Geometry outputs are renderer-independent quads with resolved ambient occlusion and normalized normals. PNG decoding, texture atlases, materials, tint or biome colors, and generic state-dependent model wiring remain outside this package.

Blockstate variants must contain at least one candidate. A definition contains either `variants` or `multipart`, not both or neither. The parser rejects non-finite geometry, UV, and tint values, and non-positive or non-finite variant weights.

## Reference implementation mapping

| Area | This package |
| --- | --- |
| Greedy merge | `domain/mesh.ts` |
| Ambient occlusion and injected-light sampling | `domain/ambient-occlusion.ts`, `domain/light-sampling.ts` |
| Fluid surface geometry | `domain/fluid-mesh.ts`; state propagation and byte encoding belong upstream |
| Cross plants and kernel special shapes | `domain/plant-mesh.ts`, `domain/special-mesh.ts` |
| LOD simplification | `domain/lod.ts`; distance selection belongs to mc-render |
| Dirty-region greedy meshing | `meshChunkRegion`; region splice optimization is not included |
| Scratch reuse | `MeshScratch` reuses mask and light work arrays; output arrays are not pooled |
| Worker protocol and materials | mc-render |
