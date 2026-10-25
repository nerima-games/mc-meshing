# Migrating to 0.4.0

This guide covers upgrades from 0.3.x to 0.4.0. Version 0.4.0 follows `@nerima-games/mc-kernel` 0.9.0 and Effect 4, with breaking type and return-value changes that require updating callers alongside the dependency pin.

## Branded block IDs

`MeshConfig` collections now use kernel `BlockId` values instead of plain numbers. Create IDs at input boundaries with the kernel's validating Result API, then use the successful value in sets and maps:

```ts
import { BlockId as KernelBlockId } from '@nerima-games/mc-kernel'
import { Result } from 'effect'

const waterId = KernelBlockId.result(rawWaterId)
if (Result.isFailure(waterId)) {
  return waterId
}

const waterBlockIds = new Set([waterId.success])
```

Do not call the brand constructor directly for untrusted values; its direct form can throw. `BlockId.result` and `BlockId.option` provide non-throwing validation.

## Branded resource names

Resource-pack resolver APIs now distinguish normalized blockstate, model, and texture names with `ResourceName`, `ModelName`, and `TextureName`. Normalize raw names before passing them to resolver or meshing functions:

```ts
import { Result } from 'effect'
import { meshBlockModel, normalizeResourceName } from '@nerima-games/mc-meshing'

const modelName = normalizeResourceName(rawModelName, 'model')
if (Result.isFailure(modelName)) {
  return modelName
}

const quads = meshBlockModel(modelName.success, assets)
if (Result.isFailure(quads)) {
  return quads
}
consumeQuads(quads.success)
```

Use `normalizeResourceName(rawName, 'blockstate')` to convert raw strings into `ResourceName` values before calling `resolveBlockStateModels` or `meshBlockState`. Raw JSON variant model names, parent names, face texture references, and asset record keys remain strings; normalization occurs at the resolver boundary. Resolved model and texture fields use `ModelName` and `TextureName`.

`LightSample` and `LightCorners` now use the kernel `LightLevel` type. The exported `QuadLight` is affected through its `block` and `sky` fields, which use `LightCorners`. Resource-pack JSON still accepts wire-format strings and numbers at parsing boundaries.

## Result-returning APIs

Operations that can fail now return `Result` values from Effect 4. Callers must handle the failure before reading `success`:

```ts
const result = meshChunk(chunk, neighbours, config)
if (Result.isFailure(result)) {
  return result
}

consumeLayers(result.success)
```

This applies to `blockCount`, `blockCountOf`, `blockIdsWithRenderKind`, `bucketFor`, `buildCrossPlantLookup`, `buildFluidLookup`, `buildLayerLookup`, `emptyChunk`, `MeshScratch.buffersFor`, `meshBlockModel`, `meshBlockState`, `meshChunk`, `meshChunkNaive`, `meshChunkRegion`, `meshFluidSurfaces`, `meshSpecialBlocks`, `normalizeResourceName`, `parseResourcePackAssets`, `parseResourcePackAssetsJson`, `railShapeAt`, `railShapeOf`, `resolveBlockModel`, `resolveBlockStateModels`, and `resolveModelTexture`. The registry-derived `MINECRAFT_*` values, `MINECRAFT_MESH_CONFIG`, and `SPECIAL_BLOCK_LOOKUP` are also fallible. `MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS` returns a `Result<Option<ReadonlySet<BlockId>>, BlockRegistryResolutionFailure>` because the registry may have no transparent solid IDs.

`ResourcePackParseError` was removed. `parseResourcePackAssets` and `parseResourcePackAssetsJson` now return `Result<ResourcePackAssets, ResourcePackParseFailure>`; inspect the failure's `_tag`, `input`, `issue`, and `message` fields.

## Public declaration changes

The lists below come from a symbol comparison of the 0.3.x package entry declaration and this release's built `dist/index.d.ts`. Update every affected call site, including helper APIs that may not be used by the main chunk mesher.

Argument or return types changed for `blockCount`, `blockCountOf`, `blockIdsWithRenderKind`, `bucketFor`, `buildCrossPlantLookup`, `buildFluidLookup`, `buildLayerLookup`, `clampMeshLight`, `emptyChunk`, `isCrossPlant`, `isFluidBlock`, `isSpecialBlock`, `layerOfBlockId`, `meshBlockModel`, `meshBlockState`, `meshChunk`, `meshChunkNaive`, `meshChunkRegion`, `meshFluidSurfaces`, `meshSpecialBlocks`, `normalizeResourceName`, `occludes`, `parseResourcePackAssets`, `parseResourcePackAssetsJson`, `railShapeAt`, `railShapeOf`, `resolveBlockModel`, `resolveBlockStateModels`, and `resolveModelTexture`. The method `MeshScratch.buffersFor` also now returns a `Result`.

`BlockId.either` and `LightLevel.either` were removed from the branded constructors. Use their `.result` or `.option` validators. `LightCorners` and `LightSample` now contain `LightLevel` values. `MeshConfig` block ID collections use `BlockId`; `ResolvedBlockModel`, `ResolvedBlockStateModel`, and `ResourceModelQuad` use branded resource names; and `clampMeshLight` returns `LightLevel`. `LodLevelSchema` and `ResourcePackAssetsSchema` use the Effect 4 schema types.

The changed exported type and value declarations are `BlockId`, `LightCorners`, `LightLevel`, `LightSample`, `LodLevelSchema`, `MINECRAFT_CROSS_PLANT_BLOCK_IDS`, `MINECRAFT_FLUID_MAX_LEVELS`, `MINECRAFT_MESH_CONFIG`, `MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS`, `MINECRAFT_WATER_BLOCK_IDS`, `MeshConfig`, `MeshScratch`, `ResolvedBlockModel`, `ResolvedBlockStateModel`, `ResourceModelQuad`, and `ResourcePackAssetsSchema`.

The additional exports are `BlockDataFailure`, `BucketFailure`, `ChunkHeightFailure`, `CrossPlantLookupFailure`, `FluidLookupFailure`, `FluidViewFailure`, `LayerLookupFailure`, `MeshConfigFailure`, `MeshScratchFailure`, `MissingFluidKindFailure`, `ModelName`, `RailShapeFailure`, `ResourceModelMeshFailure`, `ResourceModelMeshFailureCode`, `ResourceName`, `ResourcePackParseFailure`, `ResourcePackResolutionFailure`, `ResourcePackResolutionFailureCode`, `SPECIAL_BLOCK_LOOKUP`, `SpecialBlockLookup`, `SpecialBlockLookupFailure`, `SpecialMeshFailure`, and `TextureName`. `ResourcePackParseError` is the removed export.

## Chunk and mesh contracts

`ChunkView` continues to store block IDs in `Uint16Array`. This element type has the same numeric range as kernel `BlockId`, so chunk reads use the validated storage domain directly and do not allocate a `Result` for every cell. Validate raw IDs before narrowing them into the typed array.

`meshChunkRegion` now greedily merges opaque faces owned by dirty cells. Its one-cell halo remains an input for visibility and ambient-occlusion reads and never contributes output geometry. LOD still simplifies opaque cubes only; water and fluid arrays remain at level 0.
