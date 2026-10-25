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

This applies to `blockCount`, `blockCountOf`, `blockIdsWithRenderKind`, `bucketFor`, `buildCrossPlantLookup`, `buildFluidLookup`, `buildLayerLookup`, `emptyChunk`, `MeshScratch.buffersFor`, `meshBlockModel`, `meshBlockState`, `meshChunk`, `meshChunkNaive`, `meshChunkRegion`, `meshFluidSurfaces`, `meshSpecialBlocks`, `normalizeResourceName`, `parseResourcePackAssets`, `parseResourcePackAssetsJson`, `railShapeAt`, `railShapeOf`, `resolveBlockModel`, `resolveBlockStateModels`, `resolveModelTexture`, and `validateChunkViews`. The registry-derived `MINECRAFT_*` values, `MINECRAFT_MESH_CONFIG`, and `SPECIAL_BLOCK_LOOKUP` are also fallible. `MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS` returns a `Result<Option<ReadonlySet<BlockId>>, BlockRegistryResolutionFailure>` because the registry may have no transparent solid IDs.

`ResourcePackParseError` was removed. `parseResourcePackAssets` and `parseResourcePackAssetsJson` now return `Result<ResourcePackAssets, ResourcePackParseFailure>`; inspect the failure's `_tag`, `input`, `issue`, and `message` fields.

The optional blockstate resolver seed uses a stable default only when omitted or explicitly `undefined`. An explicit `null`, non-number, or non-finite seed returns `ResourcePackResolutionFailure` with code `invalid-seed`. Finite seeds are folded to 32 bits for deterministic variant selection.

## Public declaration changes

The lists below come from a symbol comparison of the 0.3.x package entry declaration and this release's built `dist/index.d.ts`. Update every affected call site, including helper APIs that may not be used by the main chunk mesher.

Argument or return types changed for `blockCount`, `blockCountOf`, `blockIdsWithRenderKind`, `bucketFor`, `buildCrossPlantLookup`, `buildFluidLookup`, `buildLayerLookup`, `clampMeshLight`, `emptyChunk`, `isCrossPlant`, `isFluidBlock`, `isSpecialBlock`, `layerOfBlockId`, `meshBlockModel`, `meshBlockState`, `meshChunk`, `meshChunkNaive`, `meshChunkRegion`, `meshFluidSurfaces`, `meshSpecialBlocks`, `normalizeResourceName`, `occludes`, `parseResourcePackAssets`, `parseResourcePackAssetsJson`, `railShapeAt`, `railShapeOf`, `resolveBlockModel`, `resolveBlockStateModels`, and `resolveModelTexture`. The method `MeshScratch.buffersFor` also now returns a `Result`. `meshChunk`, `meshChunkNaive`, and `meshChunkRegion` include `ChunkViewFailure` in their failure unions; `meshFluidSurfaces` reports the expanded `FluidViewFailure` union.

`BlockId.either` and `LightLevel.either` were removed from the branded constructors. Use `BlockId.result(rawId)` or `LightLevel.result(rawLight)` and handle the returned failure before using the branded value. Their `.option` validators are available when an invalid value should be represented as `None`.

The exported object fields were compared individually, including field optionality. These field types changed:

| Exported type | Field | 0.3.x | 0.4.0 |
| --- | --- | --- | --- |
| `LightSample` | `block`, `sky` | `number` | `LightLevel` |
| `LightCorners` | elements 0 through 3 | `number` | `LightLevel` |
| `QuadLight` | `block`, `sky` | `LightCorners` of numbers | `LightCorners` of `LightLevel` |
| `MeshConfig` | `waterBlockIds`, `transparentSolidBlockIds`, `crossPlantBlockIds` | `ReadonlySet<number>` | `ReadonlySet<BlockId>` |
| `MeshConfig` | `fluidMaxLevels` | `ReadonlyMap<number, number>` | `ReadonlyMap<BlockId, number>` |
| `ResolvedBlockModel` | `name` | `string` | `ModelName` |
| `ResolvedBlockStateModel` | `model` | `string` | `ModelName` |
| `ResourceModelQuad` | `model` | `string` | `ModelName` |
| `ResourceModelQuad` | `texture` | `string` | `TextureName` |

The checker found no added or removed fields and no optionality changes among exported object types present in both declarations. `LightCorners` is a four element tuple; the `QuadLight` fields change through that tuple alias. The new `FluidViewFailure` union has two variants: `IncompleteFluidView` contains `actual`, `coord`, `expected`, and `field` (`falling`, `levels`, or `sources`); `InvalidFluidView` contains `coord` and `field` (`falling`, `fluid`, `levels`, or `sources`) for a null sidecar or missing/invalid array.

The declaration comparison found no variant additions, removals, or field changes among the 22 exported union aliases present in both versions. `ChunkViewFailure` is a new union of `ChunkHeightFailure` and `ChunkBlocksFailure`; its two variants and fields are listed in the chunk contract section below.

These exported constant types also changed:

| Exported constant | 0.3.x | 0.4.0 |
| --- | --- | --- |
| `MINECRAFT_CROSS_PLANT_BLOCK_IDS` | `ReadonlySet<BlockId>` | `Result<ReadonlySet<BlockId>, BlockRegistryResolutionFailure>` |
| `MINECRAFT_FLUID_MAX_LEVELS` | `ReadonlyMap<BlockId, number>` | `Result<ReadonlyMap<BlockId, number>, BlockDataFailure>` |
| `MINECRAFT_MESH_CONFIG` | `MeshConfig` | `Result<MeshConfig, MeshConfigFailure>` |
| `MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS` | `ReadonlySet<BlockId>` | `Result<Option<ReadonlySet<BlockId>>, BlockRegistryResolutionFailure>` |
| `MINECRAFT_WATER_BLOCK_IDS` | `ReadonlySet<BlockId>` | `Result<ReadonlySet<BlockId>, BlockRegistryResolutionFailure>` |
| `ResourcePackAssetsSchema` | `Schema.Schema<ResourcePackAssets>` | `ResourcePackSchema<ResourcePackAssets>` |

No exported numeric constant changed from a number or numeric literal to a brand. `LodLevelSchema` retains the same emitted declaration type, `Schema.Schema<LodLevel>`, in both versions.

Create each branded value at its input boundary:

| Brand | Construction |
| --- | --- |
| `BlockId` | `BlockId.result(rawId)` from `@nerima-games/mc-kernel` |
| `LightLevel` | `LightLevel.result(rawLight)` from `@nerima-games/mc-kernel` |
| `ResourceName` | `normalizeResourceName(rawName, 'blockstate')` |
| `ModelName` | `normalizeResourceName(rawName, 'model')` |
| `TextureName` | `resolveModelTexture(model, reference)` |

The resource-name brands have no public constructors. The normalization and resolution functions return `Result`; handle failure before using the successful branded value. `clampMeshLight` also returns `LightLevel` for values that should be clamped to the supported light range. `LodLevelSchema` and `ResourcePackAssetsSchema` use the Effect 4 schema types.

The declaration checker reports differences for these exported types and values: `BlockId`, `LightCorners`, `LightLevel`, `LightSample`, `LodLevelSchema`, `MINECRAFT_CROSS_PLANT_BLOCK_IDS`, `MINECRAFT_FLUID_MAX_LEVELS`, `MINECRAFT_MESH_CONFIG`, `MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS`, `MINECRAFT_WATER_BLOCK_IDS`, `MeshConfig`, `MeshScratch`, `ResolvedBlockModel`, `ResolvedBlockStateModel`, `ResourceModelQuad`, and `ResourcePackAssetsSchema`. `LodLevelSchema` has the same emitted declaration, `Schema.Schema<LodLevel>`, in both versions; its resolved type differs in the Effect 4 checker.

The additional exports are `BlockDataFailure`, `BucketFailure`, `ChunkBlocksFailure`, `ChunkHeightFailure`, `ChunkViewFailure`, `CrossPlantLookupFailure`, `FluidLookupFailure`, `FluidViewFailure`, `LayerLookupFailure`, `MeshConfigFailure`, `MeshScratchFailure`, `MissingFluidKindFailure`, `ModelName`, `RailShapeFailure`, `ResourceModelMeshFailure`, `ResourceModelMeshFailureCode`, `ResourceName`, `ResourcePackParseFailure`, `ResourcePackResolutionFailure`, `ResourcePackResolutionFailureCode`, `SPECIAL_BLOCK_LOOKUP`, `SpecialBlockLookup`, `SpecialBlockLookupFailure`, `SpecialMeshFailure`, and `TextureName`. `validateChunkViews` is also a new export. `ResourcePackParseError` is the removed export.

`ChunkBlocksFailure` carries `_tag: 'InvalidChunkBlocksLength'`, `actual`, `expected`, and `coord`. `ChunkViewFailure` combines this with `ChunkHeightFailure`; callers of `validateChunkViews` should handle either failure before reading the validated views.

## Chunk and mesh contracts

`ChunkView` continues to store block IDs in `Uint16Array`. This element type has the same numeric range as kernel `BlockId`, so chunk reads use the validated storage domain directly and do not allocate a `Result` for every cell. Validate raw IDs before narrowing them into the typed array.

The `blocks` array must contain exactly `CHUNK_SIZE * height * CHUNK_SIZE` entries. `meshChunk`, `meshChunkNaive`, and `meshChunkRegion` validate the core chunk and every loaded neighbour before reading blocks; a mismatch returns `InvalidChunkBlocksLength` with actual and expected lengths. Out-of-range coordinates still read as `AIR`.

`meshChunkRegion` now greedily merges opaque faces owned by dirty cells. Its one-cell halo remains an input for visibility and ambient-occlusion reads and never contributes output geometry. LOD still simplifies opaque cubes only; water and fluid arrays remain at level 0.
