---
"@nerima-games/mc-meshing": minor
---

Migrate to Effect 4 and mc-kernel 0.9, brand block IDs and resource names, use the kernel LightLevel type, return structured failures from fallible APIs, reject non-finite resolver seeds, and remove ResourcePackParseError.

An omitted blockstate resolver seed uses the stable default; an explicit non-finite seed returns the `invalid-seed` resolution failure.

The built declaration comparison also records these API changes:

- Argument or return types changed for `blockCount`, `blockCountOf`, `blockIdsWithRenderKind`, `bucketFor`, `buildCrossPlantLookup`, `buildFluidLookup`, `buildLayerLookup`, `clampMeshLight`, `emptyChunk`, `isCrossPlant`, `isFluidBlock`, `isSpecialBlock`, `layerOfBlockId`, `meshBlockModel`, `meshBlockState`, `meshChunk`, `meshChunkNaive`, `meshChunkRegion`, `meshFluidSurfaces`, `meshSpecialBlocks`, `normalizeResourceName`, `occludes`, `parseResourcePackAssets`, `parseResourcePackAssetsJson`, `railShapeAt`, `railShapeOf`, `resolveBlockModel`, `resolveBlockStateModels`, and `resolveModelTexture`. `MeshScratch.buffersFor` also returns a `Result`.
- `BlockId.either` and `LightLevel.either` were removed in favor of the branded constructors' `.result` and `.option` validators. `LightCorners`, `LightSample`, `MeshConfig`, `ResolvedBlockModel`, `ResolvedBlockStateModel`, and `ResourceModelQuad` now expose branded value types. The exported `QuadLight` is affected through its `block` and `sky` fields, which use `LightCorners`. `LodLevelSchema` and `ResourcePackAssetsSchema` use Effect 4 schema types.
- Changed exported type and value declarations: `BlockId`, `LightCorners`, `LightLevel`, `LightSample`, `LodLevelSchema`, `MINECRAFT_CROSS_PLANT_BLOCK_IDS`, `MINECRAFT_FLUID_MAX_LEVELS`, `MINECRAFT_MESH_CONFIG`, `MINECRAFT_TRANSPARENT_SOLID_BLOCK_IDS`, `MINECRAFT_WATER_BLOCK_IDS`, `MeshConfig`, `MeshScratch`, `ResolvedBlockModel`, `ResolvedBlockStateModel`, `ResourceModelQuad`, and `ResourcePackAssetsSchema`.
- Added exports: `BlockDataFailure`, `BucketFailure`, `ChunkHeightFailure`, `CrossPlantLookupFailure`, `FluidLookupFailure`, `FluidViewFailure`, `LayerLookupFailure`, `MeshConfigFailure`, `MeshScratchFailure`, `MissingFluidKindFailure`, `ModelName`, `RailShapeFailure`, `ResourceModelMeshFailure`, `ResourceModelMeshFailureCode`, `ResourceName`, `ResourcePackParseFailure`, `ResourcePackResolutionFailure`, `ResourcePackResolutionFailureCode`, `SPECIAL_BLOCK_LOOKUP`, `SpecialBlockLookup`, `SpecialBlockLookupFailure`, `SpecialMeshFailure`, and `TextureName`.
- Removed export: `ResourcePackParseError`.

Use `.result` or `.option` at raw input boundaries, handle all returned `Result` failures, and update consumers to pass branded IDs and resource names.
