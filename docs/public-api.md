# 公開 API

- 出典: plan.md §3.3 + **参照実装の実コードによる検証**
- 参照実装ルート: `<reference-impl>`（以下パスはこれ相対）

## 1. 最重要の差分: `mesh` という関数は参照実装に存在しない

plan.md §3.3 は次のように書く:

> **主要な公開API**: `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}`

参照実装の入口は `greedyMeshChunk` である。
`packages/rendering/infrastructure/meshing/greedy-meshing.ts:61-74`（原文）:

```typescript
export const greedyMeshChunk = (
  chunk: Chunk,
  offset: ChunkWorldOffset,
  transparentBlockIds: ReadonlySet<number> = new Set(),
  scratch: GreedyMeshScratch = createGreedyMeshScratch(),
  lightGrids?: LightGrids,
  transparentSolidBlockIds: ReadonlySet<number> = new Set(),
  pool?: MeshAccumulatorPool,
): GreedyMeshResult => {
```

公開は `packages/rendering/index.ts:19`
（`export * from './infrastructure/meshing/greedy-meshing'`）。

### 返り値の形も違う

参照実装は `{opaque, water, transparentSolid}` を**直接返さない**。
`greedy-meshing-types.ts:72-80`（原文）:

```typescript
export type GreedyMeshResult = {
  // Zero-copy subarray views — valid until next greedyMeshChunk call (aliases accumulator backing store).
  readonly opaqueRaw: RawMeshData
  readonly waterRaw: RawMeshData | null
  // Transparent-solid (GLASS, LEAVES) faces — rendered with atlas material + transparency, not water shader.
  readonly transparentSolidRaw: RawMeshData | null
  // Lazily produces sliced (owned) copies — call only when you need independent arrays.
  readonly toMeshed: GreedyMeshToMeshed
}
```

plan.md が書く 3 つ組は、遅延サンクの向こう側にある
（`greedy-meshing-types.ts:70`）:

```typescript
export type GreedyMeshToMeshed = () => { opaque: MeshedChunk; water: MeshedChunk; transparentSolid: MeshedChunk }
```

`waterRaw` / `transparentSolidRaw` が `null` になるのは「そのレイヤの面が 1 つも無い」ときであり、
アキュムレータが遅延生成されるためこの `null` は意味を持つ信号である
（`greedy-meshing.ts:169-184`。`toMeshed()` は `EMPTY_MESHED_CHUNK` で埋め、`_meshedCache` にメモ化する）。

### 本リポジトリの選択

```typescript
export const meshChunk = (
  chunk: ChunkView,
  neighbours: ChunkNeighbours,
  config: MeshConfig,
): MeshLayers
```

plan.md の形をそのまま採り、**所有されたデータ**を返す。参照実装の subarray view は
「次の呼び出しまでしか有効でない」という実在の危険（参照実装自身がコメントで警告している）を
持ち込む。プールされた view ベースの高速経路は、ベンチマークが用意できてから
明示的な opt-in として追加する。`design-notes.md` M-5 を参照。

## 2. 三値の不透明度モデル（`domain/opacity.ts`）

```typescript
export type MeshLayer = 'opaque' | 'water' | 'transparentSolid'
export const MESH_LAYER_PRIORITY: ReadonlyArray<MeshLayer>   // ['transparentSolid', 'water', 'opaque']
export const MESH_LAYERS: ReadonlyArray<MeshLayer>           // ['opaque', 'water', 'transparentSolid']

export type MeshConfig = {
  readonly waterBlockIds: ReadonlySet<number>
  readonly transparentSolidBlockIds: ReadonlySet<number>
}
export const EMPTY_MESH_CONFIG: MeshConfig
export const MAX_BLOCK_ID = 255

export const layerOfBlockId = (config: MeshConfig, blockId: number): MeshLayer
export const buildLayerLookup = (config: MeshConfig): Uint8Array
export const occludes = (lookup: Uint8Array, blockId: number): boolean
```

### なぜ boolean の `transparent` フラグでは足りないのか

**参照実装は透過集合を 2 つ持っている。**
`packages/worker/infrastructure/meshing/meshing-worker-config.ts:7-13`（原文）:

```typescript
export const TRANSPARENT_IDS_ARRAY: readonly number[] = [blockTypeToIndex('WATER')]
export const TRANSPARENT_IDS_SET = new Set(TRANSPARENT_IDS_ARRAY)
export const TRANSPARENT_SOLID_IDS_ARRAY: readonly number[] = [
  blockTypeToIndex('GLASS'),
  blockTypeToIndex('LEAVES'),
]
export const TRANSPARENT_SOLID_IDS_SET = new Set(TRANSPARENT_SOLID_IDS_ARRAY)
```

参照実装のテストが区別を明示している
（`packages/worker/test/meshing-worker-config.test.ts:69`:
"does not include WATER (fluid, not transparent-solid)"）。

**両者は交換できない。描画方法が違うからである**:

| 集合 | 中身 | 描画 |
| --- | --- | --- |
| `TRANSPARENT_IDS` | `WATER` | 専用シェーダ（波紋・屈折・アニメーション水面・可変高さ） |
| `TRANSPARENT_SOLID_IDS` | `GLASS`, `LEAVES` | 通常のブロックアトラス材質 + アルファブレンド |

1 つの boolean に畳むと、どちらかが必ず間違って描かれる。第 3 の選択肢は存在しない。

plan.md §3.3 自身が `transparentSolid > water > opaque` という**三値の優先度**を要求している。
であれば、意味のない組み合わせを 1 つ含む 2 つの boolean ではなく、三値としてモデル化するのが正しい。

Array 形と Set 形の両方がある理由は参照実装のヘッダコメント（`meshing-worker-config.ts:3-6`）にある:
「Array forms are sent with each worker message; Set forms are used in the synchronous fallback」。
本リポジトリは Set 形だけを持つ。worker のメッセージ境界は mc-render の責務だからである。

### 優先度が「エラー」ではなく「順序」である理由

同じブロック ID が両方の集合に現れることは原理的にありうる（別のリポジトリ、別のレビュアー、
同じテーブル）。それを worker の中で実行時に発見されるエラーとして扱うのではなく、
分類を**全域かつ順序付き**にした。設定ミスは面の見た目の劣化にとどまり、チャンクが落ちることはない。

参照実装の振り分けも同じ順序である。`greedy-meshing-passes.ts:148-152`（原文）:

```typescript
const targetAcc = transparentSolidLookup[blockId] !== 0
  ? getTransparentSolidAcc()
  : transparentLookup[blockId] !== 0
    ? getWaterAcc()
    : opaqueAcc
```

`MESH_LAYER_PRIORITY` を**値**として持っているのは、この順序をテストできるようにするためである。
条件式に埋め込むと、将来の編集で静かに入れ替わっても誰も気づかない。

## 3. 面（`domain/faces.ts`）

```typescript
export type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg'
export type FaceRole = 'top' | 'bottom' | 'side'
export type Face = {
  readonly direction: FaceDirection
  readonly nx: number; readonly ny: number; readonly nz: number
  readonly role: FaceRole
}
export const FACES: ReadonlyArray<Face>
export const FACE_DIRECTIONS: ReadonlyArray<FaceDirection>
export const oppositeDirection = (direction: FaceDirection): FaceDirection
export const VERTICES_PER_QUAD = 4
export const INDICES_PER_QUAD = 6
```

### 正準順序 +X, -X, +Y, -Y, +Z, -Z

参照実装の呼び出し順（`greedy-meshing.ts:122-128`、原文）:

```typescript
  meshXPosFace(state)
  meshXNegFace(state)
  meshYPosFace(state)
  meshYNegFace(state)
  meshZPosFace(state)
  meshZNegFace(state)
```

法線と role（`greedy-meshing-algorithms.ts`）:

| 関数 | 行 | 法線 | FaceDir |
| --- | --- | --- | --- |
| `meshXPosFace` | 20 | `[1, 0, 0]`（:22） | `'side'`（:23） |
| `meshXNegFace` | 59 | `[-1, 0, 0]`（:61） | `'side'`（:62） |
| `meshYPosFace` | 98 | `[0, 1, 0]`（:100） | `'top'`（:101） |
| `meshYNegFace` | 137 | `[0, -1, 0]`（:139） | `'bottom'`（:140） |
| `meshZPosFace` | 176 | `[0, 0, 1]`（:178） | `'side'`（:179） |
| `meshZNegFace` | 215 | `[0, 0, -1]`（:217） | `'side'`（:218） |

順序を同一に保つ理由は、plan.md §3.3 がゴールデンテスト（バッファのハッシュ比較）を要求しており、
ハッシュは出力順が安定していないと意味を持たないからである。
参照実装と同一にしておけば、参照実装の fixture がそのままオラクルとして使える（plan.md §8）。

`FaceRole` が 3 値なのは、草ブロックが上面・側面・下面で違うテクスチャを要し、
それより細かい区別は一度も必要にならないからである。

## 4. チャンク（`domain/chunk-view.ts`）

```typescript
export const CHUNK_SIZE = 16
export const CHUNK_HEIGHT = 256
export const BLOCKS_PER_CHUNK = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE
export const AIR = 0

export const blockIndex = (lx: number, y: number, lz: number): number
export type ChunkView = { readonly blocks: Readonly<Uint8Array> }
export const emptyChunk = (): ChunkView

export const getBlock = (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number): number

export type ChunkNeighbours = {
  readonly xPos?: ChunkView; readonly xNeg?: ChunkView
  readonly zPos?: ChunkView; readonly zNeg?: ChunkView
  readonly xPosZPos?: ChunkView; readonly xPosZNeg?: ChunkView
  readonly xNegZPos?: ChunkView; readonly xNegZNeg?: ChunkView
}
export const getBlockAcrossBoundary = (
  chunk: ChunkView, neighbours: ChunkNeighbours, lx: number, y: number, lz: number,
): number

export type FluidView = {
  readonly levels: Readonly<Uint8Array>
  readonly sources: Readonly<Uint8Array>
  readonly falling?: Readonly<Uint8Array>
}
```

### ストレージレイアウト

`y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE`。
参照実装 `greedy-meshing-ao.ts:8` と**同一**。

y-major（カラム内で連続）にしてあるのは、メッシングも光伝播もカラムを縦に歩くからである。
参照実装と同じにしてあるのは、参照実装の chunk fixture をゴールデン入力として
そのまま使えるようにするためである。

### `getBlock` —— 3 つの意図的な選択（plan.md §5.2）

参照実装 `greedy-meshing-ao.ts:6-9`（原文）:

```typescript
export const getBlock = (blocks: Readonly<Uint8Array>, lx: number, y: number, lz: number): number => {
  if (lx < 0 || lx >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT || lz < 0 || lz >= CHUNK_SIZE) return AIR
  return blocks[y + lz * CHUNK_HEIGHT + lx * CHUNK_HEIGHT * CHUNK_SIZE]!
}
```

1. **境界チェックは 6 節の短絡 `if` としてインライン**。ヘルパに委譲しない。
   チャンクあたり約 40 万回の呼び出しでは呼び出しオーバーヘッドはノイズではない。
2. **返り値は `number` であって `Option<number>` ではない**。`Option` は範囲内の読み出しごとに
   `Some` を割り当てる。チャンクあたり数十万個の短命オブジェクトであり、
   フレームグラフで見える GC pause になる。
3. **範囲外は `AIR` を返す**。フォールバックではなく意味的に正しい答えである。
   隣接チャンクが未ロードの境界は「開いている」ものとしてメッシュされるべきで、
   そうすればプレイヤーは黒い壁ではなく地形を見る。

## 5. メッシング（`domain/mesh.ts`）

```typescript
export type Quad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number; readonly y: number; readonly lz: number
  readonly width: number; readonly height: number
}
export type MeshLayers = {
  readonly opaque: ReadonlyArray<Quad>
  readonly water: ReadonlyArray<Quad>
  readonly transparentSolid: ReadonlyArray<Quad>
  readonly crossPlants: ReadonlyArray<CrossPlantQuad>
  readonly fluids: ReadonlyArray<FluidQuad>
}
export const totalQuadCount = (layers: MeshLayers): number
export const meshChunk = (chunk: ChunkView, neighbours: ChunkNeighbours, config: MeshConfig): MeshLayers
```

流体を `MeshConfig.fluidMaxLevels` で opt-in すると、`MeshLayers.fluids` に専用の
`FluidQuad` が返る。上面 (`direction === 'yPos'`) は renderer がテクスチャを流すための記述子を持つ:

```typescript
export type FluidFlow = {
  readonly direction: readonly [x: number, z: number]
  readonly falling: boolean
}

export type FluidQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly vertices: readonly [FluidVertex, FluidVertex, FluidVertex, FluidVertex]
  readonly flow?: FluidFlow
  readonly ao: number
}
```

`flow.direction` は chunk-local X/Z の正規化ベクトルで、水平の勾配が無ければ `[0, 0]`。
同種流体の隣接水面が低い方向へ向き、空いた隣接セルの 1 段下に同種流体があれば段差を越える方向へ向く。
未ロード隣接チャンクは流れを作らない。`flow.falling` は復号済みの simulation state を写す。
`falling` と `flow` は既存 caller/consumer の型を壊さないため optional だが、現行メッシャが出す上面には
必ず `flow` があり、側面には無い。水と溶岩は同じ計算を使い、差は注入された `maxLevel` による。

通常の不透明面にはグリーディマージが入り、`width` / `height` は 1 より大きくなり得る。
一方、4 隅の高さを個別に持つ流体面は情報を失わずにマージできないため、セル単位で出力する。

### 面が出る条件

セルが非 air で、かつその方向の隣接セルが遮蔽しないとき。
`occludes` は air / water / transparentSolid のいずれにも false なので、
湖の底面もガラス箱の向こう側のペインも描かれる。

同レイヤ同士は面を出さない。隣り合う 2 つの水セルの間に表面は無いし、
2 枚のガラスの間にも無い。これが無いと湖の内部が quad の壁になり、
見た目が間違っているうえに破滅的に高価になる。

## 6. 参照実装の各部が本リポジトリでどうなったか

**この表は長らく古かった。** グリーディマージ・AO・十字板・`yLimit` は着地しているのに
「保留」「次の作業」「未実装」のまま残っていたので、流体の行を書き換えるついでに
**実際のコードに突き合わせて直した**（`design-notes.md` M-9 / M-10 / M-11 / M-12）。

| 項目 | 参照実装 | LOC | 扱い |
| --- | --- | --- | --- |
| グリーディマージ本体 | `greedy-meshing-algorithms.ts` + `-accumulator.ts` + `-passes.ts` | 616 | **移植済み**: `domain/mesh.ts`（M-9） |
| アンビエントオクルージョン | `greedy-meshing-ao.ts` | 149 | **移植済み**: `domain/ambient-occlusion.ts`（M-10）。光サンプリング半分は未移植（ライトグリッドは mc-worldgen） |
| 流体の高さ / 状態 | `greedy-meshing-fluids.ts` + `-fluid-state.ts` | 385 | **移植済み**: `domain/fluid-mesh.ts`（M-12）。renderer 向け flow descriptor を追加。バイト符号化と光は未移植 —— 継ぎ目は `FluidView`（復号済み） |
| 植生メッシュ | `plant-mesh.ts` | 258 | **十字板のみ移植済み**: `domain/plant-mesh.ts`（M-11）。サボテン・レール・スイレンは未移植 |
| LOD 段の選択（`lodForDistance` + 距離定数） | `lod-simplification.ts` | 約 48 | **mc-render の責務**（`responsibility.md` §3.4）。簡約本体（約 240）は `domain/lod.ts` に移植済み |
| subregion 差分メッシュ | `subregion-greedy.ts` + `-splice.ts` | 382 | 保留。1 ブロック変更で全チャンクを再メッシュしない最適化 |
| アキュムレータプール | `greedy-meshing-accumulator.ts` | 178 | ベンチマークを用意してから |
| worker プール / プロトコル | `packages/worker/.../meshing-worker*.ts` | 795 | **mc-render の責務**（plan.md §3.9） |
| マテリアル | `chunk-mesh-materials.ts` | 238 | **mc-render の責務** |
| `yLimit`（最高の非 air ブロックまでで打ち切る） | `greedy-meshing.ts:94-101` | — | **移植済み**: `domain/mesh.ts` の `solidCeiling`。素朴実装には**意図的に入れていない** —— オラクルが `CHUNK_HEIGHT` を走ることが `solidCeiling` の off-by-one を捕まえる仕掛けである（M-9） |
