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
exported declarations: 31
supporting declarations: 0

## Exported

### AIR  `const`

```ts
const AIR = 0;
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

### INDICES_PER_QUAD  `const`

```ts
const INDICES_PER_QUAD = 6;
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
};
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
};
```

### VERTICES_PER_QUAD  `const`

```ts
const VERTICES_PER_QUAD = 4;
```

### blockIndex  `const`

```ts
const blockIndex: (lx: number, y: number, lz: number) => number;
```

### buildLayerLookup  `const`

```ts
const buildLayerLookup: (config: MeshConfig) => Uint8Array;
```

### emptyChunk  `const`

```ts
const emptyChunk: () => ChunkView;
```

### getBlock  `const`

```ts
const getBlock: (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number) => number;
```

### getBlockAcrossBoundary  `const`

```ts
const getBlockAcrossBoundary: (chunk: ChunkView, neighbours: ChunkNeighbours, lx: number, y: number, lz: number) => number;
```

### layerOfBlockId  `const`

```ts
const layerOfBlockId: (config: MeshConfig, blockId: number) => MeshLayer;
```

### meshChunk  `const`

```ts
const meshChunk: (chunk: ChunkView, neighbours: ChunkNeighbours, config: MeshConfig) => MeshLayers;
```

### occludes  `const`

```ts
const occludes: (lookup: Uint8Array, blockId: number) => boolean;
```

### oppositeDirection  `const`

```ts
const oppositeDirection: (direction: FaceDirection) => FaceDirection;
```

### totalQuadCount  `const`

```ts
const totalQuadCount: (layers: MeshLayers) => number;
```
