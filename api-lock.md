# API lock — @nerima-games/mc-meshing

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 59
supporting declarations: 0

## Exported

### AIR  `const`

```ts
const AIR = 0;
```

### AO_LEVELS  `const`

```ts
const AO_LEVELS = 4;
```

### AO_MAX  `const`

```ts
const AO_MAX: number;
```

### AO_NONE  `const`

```ts
const AO_NONE = 0;
```

### BLOCKS_PER_CHUNK  `const`

```ts
const BLOCKS_PER_CHUNK: number;
```

### CHUNK_HEIGHT  `const`

```ts
const CHUNK_HEIGHT = 256;
```

### CHUNK_SIZE  `const`

```ts
const CHUNK_SIZE = 16;
```

### ChunkNeighbours  `type`

```ts
type ChunkNeighbours = {
    readonly xPos?: ChunkView;
    readonly xNeg?: ChunkView;
    readonly zPos?: ChunkView;
    readonly zNeg?: ChunkView;
};
```

### ChunkView  `type`

```ts
type ChunkView = {
    readonly blocks: Readonly<Uint8Array>;
    readonly fluid?: FluidView;
};
```

### CrossPlantQuad  `type`

```ts
type CrossPlantQuad = {
    readonly blockId: number;
    readonly role: FaceRole;
    readonly vertices: readonly [PlantVertex, PlantVertex, PlantVertex, PlantVertex];
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
    readonly ao: number;
};
```

### EMPTY_MESH_CONFIG  `const`

```ts
const EMPTY_MESH_CONFIG: MeshConfig;
```

### FACES  `const`

```ts
const FACES: ReadonlyArray<Face>;
```

### FACE_DIRECTIONS  `const`

```ts
const FACE_DIRECTIONS: ReadonlyArray<FaceDirection>;
```

### Face  `type`

```ts
type Face = {
    readonly direction: FaceDirection;
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
    readonly role: FaceRole;
};
```

### FaceDirection  `type`

```ts
type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg';
```

### FaceRole  `type`

```ts
type FaceRole = 'top' | 'bottom' | 'side';
```

### FluidQuad  `type`

```ts
type FluidQuad = {
    readonly blockId: number;
    readonly direction: FaceDirection;
    readonly vertices: readonly [FluidVertex, FluidVertex, FluidVertex, FluidVertex];
    readonly ao: number;
};
```

### FluidVertex  `type`

```ts
type FluidVertex = readonly [number, number, number];
```

### FluidView  `type`

```ts
type FluidView = {
    readonly levels: Readonly<Uint8Array>;
    readonly sources: Readonly<Uint8Array>;
};
```

### INDICES_PER_QUAD  `const`

```ts
const INDICES_PER_QUAD = 6;
```

### LOD_LEVELS  `const`

```ts
const LOD_LEVELS: readonly [0, 1, 2];
```

### LodLevel  `type`

```ts
type LodLevel = (typeof LOD_LEVELS)[number];
```

### LodLevelSchema  `const`

```ts
const LodLevelSchema: Schema.Literal<[0, 1, 2]>;
```

### MAX_BLOCK_ID  `const`

```ts
const MAX_BLOCK_ID = 255;
```

### MESH_LAYERS  `const`

```ts
const MESH_LAYERS: ReadonlyArray<MeshLayer>;
```

### MESH_LAYER_PRIORITY  `const`

```ts
const MESH_LAYER_PRIORITY: ReadonlyArray<MeshLayer>;
```

### MeshConfig  `type`

```ts
type MeshConfig = {
    readonly waterBlockIds: ReadonlySet<number>;
    readonly transparentSolidBlockIds: ReadonlySet<number>;
    readonly crossPlantBlockIds?: ReadonlySet<number>;
    readonly fluidMaxLevels?: ReadonlyMap<number, number>;
};
```

### MeshLayer  `type`

```ts
type MeshLayer = 'opaque' | 'water' | 'transparentSolid';
```

### MeshLayers  `type`

```ts
type MeshLayers = {
    readonly [K in MeshLayer]: ReadonlyArray<Quad>;
} & {
    readonly crossPlants: ReadonlyArray<CrossPlantQuad>;
    readonly fluids: ReadonlyArray<FluidQuad>;
};
```

### PLANT_INSET  `const`

```ts
const PLANT_INSET = 0.1;
```

### PlantVertex  `type`

```ts
type PlantVertex = readonly [number, number, number];
```

### Quad  `type`

```ts
type Quad = {
    readonly blockId: number;
    readonly direction: FaceDirection;
    readonly role: FaceRole;
    readonly lx: number;
    readonly y: number;
    readonly lz: number;
    readonly width: number;
    readonly height: number;
    readonly ao: number;
};
```

### QuadAxis  `type`

```ts
type QuadAxis = 'x' | 'y' | 'z';
```

### SOURCE_SURFACE_HEIGHT  `const`

```ts
const SOURCE_SURFACE_HEIGHT: number;
```

### STEP_FOR_LOD  `const`

```ts
const STEP_FOR_LOD: Readonly<Record<LodLevel, number>>;
```

### VERTICES_PER_QUAD  `const`

```ts
const VERTICES_PER_QUAD = 4;
```

### ambientOcclusionAt  `const`

```ts
const ambientOcclusionAt: (chunk: ChunkView, neighbours: ChunkNeighbours, direction: FaceDirection, lx: number, y: number, lz: number) => number;
```

### blockIndex  `const`

```ts
const blockIndex: (lx: number, y: number, lz: number) => number;
```

### buildCrossPlantLookup  `const`

```ts
const buildCrossPlantLookup: (config: MeshConfig) => Uint8Array;
```

### buildFluidLookup  `const`

```ts
const buildFluidLookup: (config: MeshConfig) => Uint8Array;
```

### buildLayerLookup  `const`

```ts
const buildLayerLookup: (config: MeshConfig) => Uint8Array;
```

### emptyChunk  `const`

```ts
const emptyChunk: () => ChunkView;
```

### faceOf  `const`

```ts
const faceOf: (direction: FaceDirection) => Face;
```

### getBlock  `const`

```ts
const getBlock: (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number) => number;
```

### getBlockAcrossBoundary  `const`

```ts
const getBlockAcrossBoundary: (chunk: ChunkView, neighbours: ChunkNeighbours, lx: number, y: number, lz: number) => number;
```

### isCrossPlant  `const`

```ts
const isCrossPlant: (lookup: Uint8Array, blockId: number) => boolean;
```

### isFluidBlock  `const`

```ts
const isFluidBlock: (lookup: Uint8Array, blockId: number) => boolean;
```

### layerOfBlockId  `const`

```ts
const layerOfBlockId: (config: MeshConfig, blockId: number) => MeshLayer;
```

### meshChunk  `const`

```ts
const meshChunk: (chunk: ChunkView, neighbours: ChunkNeighbours, config: MeshConfig) => MeshLayers;
```

### meshChunkNaive  `const`

```ts
const meshChunkNaive: (chunk: ChunkView, neighbours: ChunkNeighbours, config: MeshConfig) => MeshLayers;
```

### meshCrossPlants  `const`

```ts
const meshCrossPlants: (chunk: ChunkView, plantLookup: Uint8Array, yLimit: number) => ReadonlyArray<CrossPlantQuad>;
```

### meshFluidSurfaces  `const`

```ts
const meshFluidSurfaces: (chunk: ChunkView, neighbours: ChunkNeighbours, fluids: Uint8Array, layers: Uint8Array, plants: Uint8Array, yLimit: number) => ReadonlyArray<FluidQuad>;
```

### occludes  `const`

```ts
const occludes: (lookup: Uint8Array, blockId: number) => boolean;
```

### oppositeDirection  `const`

```ts
const oppositeDirection: (direction: FaceDirection) => FaceDirection;
```

### packQuadKey  `const`

```ts
const packQuadKey: (nx: number, ny: number, nz: number, p0x: number, p0y: number, p0z: number, p2x: number, p2y: number, p2z: number) => number;
```

### simplifyMesh  `const`

```ts
const simplifyMesh: (layers: MeshLayers, level: LodLevel) => MeshLayers;
```

### tangentAxes  `const`

```ts
const tangentAxes: (direction: FaceDirection) => readonly [QuadAxis, QuadAxis];
```

### totalQuadArea  `const`

```ts
const totalQuadArea: (layers: MeshLayers) => number;
```

### totalQuadCount  `const`

```ts
const totalQuadCount: (layers: MeshLayers) => number;
```
