# 公開 API

- 出典: plan.md §3.3 と参照実装の検証
- 実装の正典: `src/index.ts` と各 `src/domain/*.ts`

## 1. メッシング入口と戻り値

```typescript
import { blockCount, meshChunk, type ChunkView } from '@nerima-games/mc-meshing'

const blocks = new Uint8Array(blockCount(kernelChunk.height))
kernelChunk.blocks.copyTo(blocks)
const view: ChunkView = {
  coord: kernelChunk.coord,
  height: kernelChunk.height,
  blocks,
}
const layers = meshChunk(view, neighbours, config)
```

呼び出し側は mc-kernel の `Chunk` から `coord` と `height` を引き継ぎ、opaque な
`blocks` を `copyTo` でメッシング用の byte view にコピーして `ChunkView` を組み立てる。
`blockCount` は可変高さの範囲を検証し、必要なストレージ長を算出する。`meshChunk` は `ChunkView`、
隣接チャンク、注入された `MeshConfig` を受け取り、呼び出し側が所有できる `MeshLayers` を返す。
返り値は cube 面と専用形状を別のコレクションに保持する。

連続して複数チャンクをメッシュ化する呼び出し元は、面マスクとライト用一時配列を再利用できる。
`MeshScratch` は呼び出し元が保持する逐次処理用の作業領域であり、同じインスタンスを並行呼び出しで共有してはならない。
scratch を渡しても返り値の配列と quad は毎回所有され、次のメッシュ化で変更されない。

```typescript
import { createMeshScratch, meshChunk } from '@nerima-games/mc-meshing'

const scratch = createMeshScratch()
const layers = meshChunk(view, neighbours, config, scratch)
```

```typescript
export type MeshLayers = {
  readonly opaque: ReadonlyArray<Quad>
  readonly water: ReadonlyArray<Quad>
  readonly transparentSolid: ReadonlyArray<Quad>
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly specialBlocks: ReadonlyArray<SpecialBlockQuad>
  readonly fluids: ReadonlyArray<FluidQuad>
}
```

通常の cube 面は同一スライス・方向・block ID・AO の面をグリーディにまとめる。
`meshChunkNaive` はマージのオラクル、`meshChunkRegion` は dirty region と halo を受け取る局所更新 API である。
`totalQuadCount` は cube quad 数、`totalQuadArea` はマージ前の面積を数える。

## 2. 三値の不透明度モデル (`domain/opacity.ts`)

```typescript
export type MeshLayer = 'opaque' | 'water' | 'transparentSolid'
export const MESH_LAYER_PRIORITY: ReadonlyArray<MeshLayer> // transparentSolid, water, opaque
export const MESH_LAYERS: ReadonlyArray<MeshLayer> // opaque, water, transparentSolid

export type MeshConfig = {
  readonly waterBlockIds: ReadonlySet<number>
  readonly transparentSolidBlockIds: ReadonlySet<number>
  readonly crossPlantBlockIds: ReadonlySet<number>
  readonly fluidMaxLevels: ReadonlyMap<number, number>
}
export const EMPTY_MESH_CONFIG: MeshConfig
export const MINECRAFT_MESH_CONFIG: MeshConfig
export const MAX_BLOCK_ID = 255

export const layerOfBlockId = (config: MeshConfig, blockId: number): MeshLayer
export const buildLayerLookup = (config: MeshConfig): Uint8Array
export const occludes = (lookup: Uint8Array, blockId: number): boolean
export const buildFluidLookup = (config: MeshConfig): Uint16Array
export const isFluidBlock = (lookup: Uint16Array, blockId: number): boolean
```

`waterBlockIds` と `transparentSolidBlockIds` は native `Set` であり、`MESH_LAYER_PRIORITY` は両方に
含まれる ID の分類順を値として固定する。`crossPlantBlockIds` は材質層ではなく形状を選び、
`fluidMaxLevels` は流体セルの高さを決めるための注入値である。
流体ブロック ID は整数 `0..MAX_BLOCK_ID`、最大レベルは整数 `0..255` でなければならない。
`buildFluidLookup` は最大レベル `255` を保持できる `Uint16Array` を構築し、範囲外の値には
`RangeError` を送出する。
これらの `Set` / `Map` は `meshChunk` の初回利用後に変更しないこと。分類を変更する場合は、
新しいコレクションと `MeshConfig` を作る。内部 lookup table はコレクションの identity で
メモ化される。

## 3. 面 (`domain/faces.ts`)

```typescript
export type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg'
export type FaceRole = 'top' | 'bottom' | 'side'
export type FacePlacementFor<Direction extends FaceDirection> =
  Direction extends 'xPos' ? { readonly direction: 'xPos'; readonly role: 'side' }
  : Direction extends 'xNeg' ? { readonly direction: 'xNeg'; readonly role: 'side' }
  : Direction extends 'yPos' ? { readonly direction: 'yPos'; readonly role: 'top' }
  : Direction extends 'yNeg' ? { readonly direction: 'yNeg'; readonly role: 'bottom' }
  : Direction extends 'zPos' ? { readonly direction: 'zPos'; readonly role: 'side' }
  : { readonly direction: 'zNeg'; readonly role: 'side' }
export type FacePlacement =
  | { readonly direction: 'xPos'; readonly role: 'side' }
  | { readonly direction: 'xNeg'; readonly role: 'side' }
  | { readonly direction: 'yPos'; readonly role: 'top' }
  | { readonly direction: 'yNeg'; readonly role: 'bottom' }
  | { readonly direction: 'zPos'; readonly role: 'side' }
  | { readonly direction: 'zNeg'; readonly role: 'side' }
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
export const FACE_DIRECTIONS: ReadonlyArray<FaceDirection>
export const FACES: ReadonlyArray<Face>
export const VERTICES_PER_QUAD = 4
export const INDICES_PER_QUAD = 6
export function faceOf<Direction extends FaceDirection>(direction: Direction): FaceFor<Direction>
export const facePlacementOf = <Direction extends FaceDirection>(direction: Direction): FacePlacementFor<Direction>
export function oppositeDirection<Direction extends FaceDirection>(direction: Direction): OppositeDirectionFor<Direction>
export function tangentAxes<Direction extends FaceDirection>(direction: Direction): TangentAxesFor<Direction>
```

面の順序は `+X, -X, +Y, -Y, +Z, -Z` であり、頂点 winding と texture / normal の解釈に結び付くため公開値として固定する。
`FaceFor<Direction>` は方向に対応する法線と `role` の相関を保持するため、`faceOf('yPos')` の戻り値は `ny: 1` と `role: 'top'` まで静的に確定する。
同様に `TangentAxesFor<Direction>` は面の `width` / `height` 軸を、`OppositeDirectionFor<Direction>` は逆方向を、リテラル方向から静的に確定する。

## 4. チャンク (`domain/chunk-view.ts`)

```typescript
export const CHUNK_SIZE = 16
export const CHUNK_HEIGHT = 256
export const BLOCKS_PER_CHUNK = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE
export const AIR = 0
export const blockCount = (height: number): number
export const blockCountOf = (height: number): number

export type ChunkCoord = { readonly cx: number; readonly cz: number }
export type ChunkView = {
  readonly coord: ChunkCoord
  readonly height: number
  readonly blocks: Readonly<Uint8Array>
  readonly fluid?: FluidView
  readonly railShapes?: RailShapeView
  readonly light?: LightView
}
export const blockIndex = (lx: number, y: number, lz: number, height?: number): number
export const getBlock = (
  chunk: Pick<ChunkView, 'blocks' | 'height'>,
  lx: number,
  y: number,
  lz: number,
): BlockId
export const getBlockAcrossBoundary = (...): BlockId
export const emptyChunk = (height?: number): ChunkView
```

ストレージは X、Z、Y の順で、`blockIndex(lx, y, lz, height) = y + lz * height + lx * height * CHUNK_SIZE`。
`ChunkView.coord` は kernel のチャンク座標を保持し、`ChunkView.height` はチャンクごとの垂直範囲である。
`CHUNK_HEIGHT` はデフォルト値にすぎない。`blockCountOf` は互換 alias であり、`blockCount` と同じ検証を行う。
`blockIndex` の高さは省略時に `CHUNK_HEIGHT` となる。`getBlock` は `ChunkView` の `blocks` と `height` を
受け取り、範囲外を `AIR` として返す。隣接チャンクを含む読み出しは `getBlockAcrossBoundary` が担当する。

`FluidView` は同じインデックス配置の `levels`、`sources`、`falling` を持つ復号済み状態である。
`ChunkView.fluid` 自体は入力側に sidecar がない場合のため optional だが、存在する場合は 3 配列をすべて渡す。
流体の伝播規則やバイト符号化はこのパッケージの責務ではない。
`RailShapeView` は同じインデックス配置の vanilla rail state code である。`RAIL_SHAPES`、
`railShapeCodeOf`、`railShapeOf` で 10 個の blockstate 名と compact code を対応付ける。
sidecar が無いセルは `north_south` の形状としてメッシュ化されるが、出力 quad の `railShape` は
明示的な sidecar 値がある場合だけ持つ。
`LightView` は同じインデックス配置の `blockLight` と `skyLight` を持ち、値は 0..15 の光量である。
ライトグリッドの生成・伝播は呼び出し側の責務であり、メッシャーは注入されたグリッドを面の四隅へ
サンプリングする。`light` が無い場合、メッシュは光量属性を出力しない。

## 5. メッシング (`domain/mesh.ts`)

```typescript
export type Quad = {
  readonly blockId: BlockId
  readonly lx: number; readonly y: number; readonly lz: number
  readonly width: number; readonly height: number
  readonly ao: number
  readonly light?: QuadLight
} & FacePlacement

export const meshChunk = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
  scratch?: MeshScratch,
): MeshLayers
export const meshChunkNaive = (...): MeshLayers
export const meshChunkRegion = (...): RegionMesh
```

`specialBlocks` は mc-kernel が宣言する cactus、slab、pressure plate、rail、lily pad の専用 geometry を
`SpecialBlockQuad` として返す。`SpecialBlockQuad` は `Face` と同じ方向・法線・`role` の相関を持ち、
`kind: 'rail'` のときだけ
`railKind: 'normal' | 'powered'` を持ち、その他の形状には rail 固有データを含めない。registry の rail kind は保持するが、
`ChunkView.railShapes` があれば `railShape` も保持する。rail の平面・曲線状態は vanilla の平面モデル、
ascending 状態は vanilla の raised NE / SW model に対応する上下 2 面として生成される。

`fluids` は `fluidMaxLevels` に登録された流体について出力される。流体面は四隅の高さを保持するためセル単位で出力し、
上面には renderer がテクスチャを流すための `FluidFlow` と AO を持たせる。通常の cube 面だけがグリーディマージ対象である。

### 5.1 描画用 typed array packing (`domain/mesh-buffers.ts`)

```typescript
export const MESH_BUFFER_LAYERS: ReadonlyArray<MeshBufferLayer>

export type PackedMeshBuffers = {
  readonly positions: Float32Array
  readonly normals: Int8Array
  readonly blockIds: Uint8Array
  readonly ao: Uint8Array
  readonly blockLight: Uint8Array
  readonly skyLight: Uint8Array
  readonly indices: Uint32Array
  readonly groups: ReadonlyArray<MeshBufferGroup>
}

export const packMeshLayers = (layers: MeshLayers): PackedMeshBuffers
```

`packMeshLayers` は `MeshLayers` の cube、cross-plant、fluid、special-block quad を安定したレイヤー順で
所有された typed array に変換する。頂点属性は位置 xyz (`Float32Array`)、法線 xyz (`Int8Array`)、block ID と AO
、block light と sky light (`Uint8Array`)、index は `Uint32Array` で、各レイヤーの範囲は `groups` から取得する。
結果は GPU に upload
できるデータだが、WebGL / GPU device、texture、material の所有権は持たない。

## 6. Resource-pack JSON (`domain/resource-pack-*.ts`)

`domain/resource-pack-schema.ts` は対応する JSON subset を `unknown` 値または JSON 文字列から検証し、
`ResourcePackAssets` に変換する。zip / filesystem からの asset discovery や PNG loader は持たない。
検証済みの `ResourcePackAssets` を渡すと、純粋な resolver と model mesher が blockstate から model quad までを解決する。

```typescript
export type ResourcePackAssets = {
  readonly blockstates: Readonly<Record<string, BlockStateDefinition>>
  readonly models: Readonly<Record<string, BlockModel>>
}

export const ResourcePackAssetsSchema: Schema.Schema<ResourcePackAssets>
export class ResourcePackParseError extends Error
export const parseResourcePackAssets = (value: unknown): ResourcePackAssets
export const parseResourcePackAssetsJson = (value: string): ResourcePackAssets
export const normalizeResourceName = (name: string, kind: 'blockstate' | 'model'): string
export const resolveBlockStateModels = (...): ReadonlyArray<ResolvedBlockStateModel>
export const resolveBlockModel = (...): ResolvedBlockModel
export const resolveModelTexture = (...): string
export const meshBlockModel = (...): ReadonlyArray<ResourceModelQuad>
export const meshBlockState = (...): ReadonlyArray<ResourceModelQuad>
```

`BlockStateVariantList` は `readonly [BlockStateVariant, ...BlockStateVariant[]]` であり、
variants の配列値と multipart の `apply` 配列は空にできない。`ResourcePackAssetsSchema` と
パーサーもこの境界を検証する。モデルの `elements` や条件の配列とは異なり、variant 選択には必ず
1 つ以上の候補が必要である。`BlockStateDefinition` は `variants` または `multipart` の排他的
union で、両方を持つ定義やどちらも持たない定義は受け付けない。
パーサー境界ではモデルの座標・UV・`tintindex` を有限数に限定し、variant の `weight` を有限かつ 0 より大きい値に限定する。

variants、multipart の `OR` / `AND` 条件、重み付き選択、親 model、texture variable、`ambientocclusion`、block / element rotation、UV、
UV lock、`cullface`、`tintindex` を扱う。element rotation は旧来の `axis` / `angle` 形式と、Snapshot 25w46a の
`x` / `y` / `z` 形式を受け付け、後者は X → Y → Z の順に任意の有限角度で適用する。両方がある場合は旧来の
`axis` / `angle` を優先し、`rescale` も保持する。返り値は renderer 非依存の純粋な quad 記述子であり、各 quad に
解決済みモデルの `ambientOcclusion` と、回転後ジオメトリから求めた正規化済み `normal` も保持する。element
rotation は face 名や `cullface` の方向を変更せず、blockstate の回転はそれらの向きを変換する。PNG、texture atlas、
material、tint / biome color、generic な state-dependent model と block-state sidecar の接続はこの層の外側にある。
入力モデルの `faces` と `cullface` は Java Edition の面名（`down` / `up` / `north` / `south` / `west` / `east`）で表し、
出力 quad の `direction` と `cullface` は §3 の内部 `FaceDirection` で表す。

## 7. 参照実装の各部が本リポジトリでどうなったか

| 項目 | 参照実装 | 扱い |
| --- | --- | --- |
| グリーディマージ本体 | `greedy-meshing-algorithms.ts` + `-accumulator.ts` + `-passes.ts` | **移植済み**: `domain/mesh.ts` |
| アンビエントオクルージョン | `greedy-meshing-ao.ts` | **移植済み**: `domain/ambient-occlusion.ts` と `domain/light-sampling.ts`。注入済みライトの四隅サンプリングまで実装済み。グリッド生成・伝播は外部 |
| 流体の高さ / 状態 | `greedy-meshing-fluids.ts` + `-fluid-state.ts` | **移植済み**: `domain/fluid-mesh.ts`。伝播とバイト符号化は `FluidView` 境界より上流の外部責務 |
| 植生メッシュ | `plant-mesh.ts` | 十字板は `domain/plant-mesh.ts`、kernel 専用形状は `domain/special-mesh.ts` |
| LOD 段の選択 | `lod-simplification.ts` | 段の選択は mc-render、簡約本体は `domain/lod.ts` |
| subregion 差分メッシュ | `subregion-greedy.ts` + `-splice.ts` | `meshChunkRegion` として一部移植済み。差分 splice 最適化は保留 |
| アキュムレータプール | `greedy-meshing-accumulator.ts` | 出力配列のプールは採用しない。`MeshScratch` は面マスク／ライト作業配列だけを再利用し、出力所有権を維持 |
| worker プール / プロトコル | `packages/worker/.../meshing-worker*.ts` | mc-render の責務 |
| マテリアル | `chunk-mesh-materials.ts` | mc-render の責務 |
| `yLimit` | `greedy-meshing.ts:94-101` | `domain/mesh.ts` の `solidCeiling` として移植済み |
