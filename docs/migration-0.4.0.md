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

Use `normalizeResourceName(rawName, 'blockstate')` for `ResourceName` inputs to `resolveBlockStateModels` and `meshBlockState`. Raw JSON variant model names, parent names, face texture references, and asset record keys remain strings; normalization occurs at the resolver boundary. Resolved model and texture fields use `ModelName` and `TextureName`.

`LightSample`, `LightCorners`, and `QuadLight` now use the kernel `LightLevel` type. Resource-pack JSON still accepts wire-format strings and numbers at parsing boundaries.

## Result-returning APIs

Operations that can fail now return `Result` values from Effect 4. Callers must handle the failure before reading `success`:

```ts
const result = meshChunk(chunk, neighbours, config)
if (Result.isFailure(result)) {
  return result
}

consumeLayers(result.success)
```

This applies to `blockCount`, `emptyChunk`, `buildLayerLookup`, `buildCrossPlantLookup`, `buildFluidLookup`, `maxLevelOf`, the registry-derived `MINECRAFT_*` tables and `MINECRAFT_MESH_CONFIG`, `SPECIAL_BLOCK_LOOKUP`, all three chunk mesh entry points, and both resource-pack parsers. Resource-pack model resolution and meshing also return `Result` failures for invalid names, missing assets, cycles, and invalid geometry.

`ResourcePackParseError` was removed. `parseResourcePackAssets` and `parseResourcePackAssetsJson` now return `Result<ResourcePackAssets, ResourcePackParseFailure>`; inspect the failure's `_tag`, `input`, `issue`, and `message` fields.

## Chunk and mesh contracts

`ChunkView` continues to store block IDs in `Uint16Array`. This element type has the same numeric range as kernel `BlockId`, so chunk reads use the validated storage domain directly and do not allocate a `Result` for every cell. Validate raw IDs before narrowing them into the typed array.

`meshChunkRegion` now greedily merges opaque faces owned by dirty cells. Its one-cell halo remains an input for visibility and ambient-occlusion reads and never contributes output geometry. LOD still simplifies opaque cubes only; water and fluid arrays remain at level 0.
