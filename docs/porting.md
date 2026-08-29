# 移植元と実測 LOC

- 参照実装ルート: `<reference-impl>`（以下パスはこれ相対）
- 計測日: 2026-07-26
- 計測方法: `wc -l`（コメント・空行を含む物理行数）

**plan.md の LOC 見積もりは信頼できない。** 本書の数値はすべてこのリポジトリで
`wc -l` を実行して確認したものである。

## 1. plan.md §3.3 の記述と実測

> **移植元**: greedy-meshing.ts + chunk-mesh-geometry + meshing-worker-config.ts（計 3,994 LOC）

### 1.1 名指しされた 3 ファイル: 実測 **343 LOC**（3,994 ではない）

| ファイル | 実測 LOC |
| --- | --- |
| `packages/rendering/infrastructure/meshing/greedy-meshing.ts` | 192 |
| `packages/rendering/infrastructure/meshing/chunk-mesh-geometry.ts` | 109 |
| `packages/worker/infrastructure/meshing/meshing-worker-config.ts` | 42 |
| **合計** | **343** |

`chunk-mesh-geometry*` にマッチするソースファイルは 1 つだけである（テスト兄弟ファイルは無い）。

### 1.2 メッシングモジュール全体: 実測 **3,830 LOC / 23 ファイル**

`packages/rendering/infrastructure/meshing/`（17 ファイル）と
`packages/worker/infrastructure/meshing/`（6 ファイル）:

| ファイル | LOC |
| --- | --- |
| `rendering/.../block-mesh.ts` | 91 |
| `rendering/.../chunk-mesh-geometry.ts` | 109 |
| `rendering/.../chunk-mesh-materials.ts` | 238 |
| `rendering/.../chunk-mesh.ts` | 196 |
| `rendering/.../greedy-meshing-accumulator.ts` | 178 |
| `rendering/.../greedy-meshing-algorithms.ts` | 252 |
| `rendering/.../greedy-meshing-ao.ts` | 149 |
| `rendering/.../greedy-meshing-fluid-state.ts` | 180 |
| `rendering/.../greedy-meshing-fluids.ts` | 205 |
| `rendering/.../greedy-meshing-passes.ts` | 186 |
| `rendering/.../greedy-meshing-quads.ts` | 2 |
| `rendering/.../greedy-meshing-types.ts` | 87 |
| `rendering/.../greedy-meshing.ts` | 192 |
| `rendering/.../lod-simplification.ts` | 288 |
| `rendering/.../plant-mesh.ts` | 258 |
| `rendering/.../subregion-greedy-splice.ts` | 195 |
| `rendering/.../subregion-greedy.ts` | 187 |
| `worker/.../meshing-worker-config.ts` | 42 |
| `worker/.../meshing-worker-pool-port-layer.ts` | 22 |
| `worker/.../meshing-worker-pool-protocol.ts` | 153 |
| `worker/.../meshing-worker-pool.ts` | 307 |
| `worker/.../meshing-worker-sync.ts` | 117 |
| `worker/.../meshing-worker.ts` | 196 |
| **合計** | **3,830** |

`greedy-meshing-quads.ts` は `greedy-meshing-accumulator.ts` への 2 行の re-export shim である。

**3,994 という数字は再現できない。** 名指しの 3 ファイル（343）でも、
モジュール全体（3,830）でもない。plan.md が採った境界が何かは特定できなかった。

### 1.3 本リポジトリが採る数字

**移植対象は 3,830 のうち約 2,400 LOC** である。残りは別リポジトリの責務:

| 除外するもの | LOC | 帰属 |
| --- | --- | --- |
| `chunk-mesh-materials.ts` | 238 | mc-render（マテリアルは描画） |
| `chunk-mesh.ts` | 196 | mc-render（`Mesh` オブジェクトの管理） |
| `worker/**`（config 以外） | 795 | mc-render（ワーカープールは plan.md §3.9） |
| `lod-simplification.ts` のうち `lodForDistance` + 距離定数 | 約 48 | mc-render（`responsibility.md` §3.4）。残りの約 240 は移植済み |

## 2. 移植したファイルの対応

| 参照実装 | 本リポジトリ | 備考 |
| --- | --- | --- |
| `worker/.../meshing-worker-config.ts:7-13`（2 つの透過集合） | `domain/opacity.ts` の `MeshConfig` | boolean ではなく三値の `MeshLayer` としてモデル化（`design-notes.md` M-3） |
| `rendering/.../greedy-meshing.ts:41-57`（`buildLookup` + `WeakMap`） | `domain/opacity.ts` の `buildLayerLookup` と `domain/mesh-common.ts` の `layerLookupForMesh` | `meshChunk*` は2つの Set identity でメモ化。公開 `buildLayerLookup` は単独利用向けに毎回新規生成し、config の集合は呼び出し側が保持・不変扱いする |
| `rendering/.../greedy-meshing-passes.ts:148-152`（振り分け優先度） | `domain/opacity.ts` の `layerOfBlockId` | 入れ子三項 → 値としての `MESH_LAYER_PRIORITY` |
| `rendering/.../greedy-meshing.ts:122-128`（面パスの呼び出し順） | `domain/faces.ts` の `FACES` | 順序を値として固定 |
| `rendering/.../greedy-meshing-algorithms.ts` の各法線・role | `domain/faces.ts` の `FACES` | 表は `public-api.md` §3 |
| `rendering/.../greedy-meshing-ao.ts:6-9`（`getBlock`） | `domain/chunk-view.ts` の `getBlock` | 3 つの性能例外そのまま（`design-notes.md` M-2） |
| `rendering/.../greedy-meshing-ao.ts:8`（ストレージレイアウト） | `domain/chunk-view.ts` の `blockIndex` | **同一**。参照実装の fixture 互換のため |
| `rendering/.../greedy-meshing-types.ts:40`（`AIR = 0`） | `domain/chunk-view.ts` の `AIR` | 同一 |
| `rendering/.../greedy-meshing-fluid-state.ts:37-43`（水面高） | `domain/fluid-state.ts` の `SOURCE_SURFACE_HEIGHT` / `heightForLevel` | `maxLevel` は注入（`design-notes.md` M-12） |
| `rendering/.../greedy-meshing-fluid-state.ts:74-127`（4 隅の平均） | `domain/fluid-state.ts` の `cornerHeight` | 水面の幾何形状。renderer 向けの方向は復号済み状態から `FluidFlow` として追加 |
| `rendering/.../greedy-meshing-fluid-state.ts:133-134`（`isFluidFaceOccluder`） | `domain/fluid-state.ts` の `hidesFluidFace` | `occludes()` で表現。植物も遮蔽しない（M-11 との整合） |
| `rendering/.../greedy-meshing-fluids.ts:15-205`（`meshFluidFaces`） | `domain/fluid-mesh.ts` の `meshFluidSurfaces`（状態は `domain/fluid-state.ts`、頂点生成は `domain/fluid-geometry.ts`） | 光とワールドオフセットを外した。側面 4 本は 1 つの関数に畳んだ |
| `block/domain/fluid.ts:7-30`（5 つのマスクと `decodeFluidByte`） | **移植していない** | 符号化は所有者のもの。§3.2 |

### 実装の分割と公開境界

`domain/mesh.ts` は greedy メッシャの公開入口と本体であり、共有するホットパスと lookup cache は
`domain/mesh-common.ts`、素朴メッシャのオラクルは `domain/mesh-naive.ts`、region メッシャは
`domain/mesh-region.ts`、結果データ型は `domain/mesh-types.ts` に分割している。素朴メッシャと
region メッシャは `domain/mesh.ts` から再エクスポートする。

流体も `domain/fluid-mesh.ts` を安定した公開 façade とし、状態計算を `domain/fluid-state.ts`、
頂点・面の生成を `domain/fluid-geometry.ts` に分ける。これらは互換層ではなく、入力状態と出力
ジオメトリの責務を分離するための内部構造である。

## 3. `ChunkView` と `FluidView` について —— 2 つの境界

### 3.1 `ChunkView`

`domain/chunk-view.ts` の `ChunkView` は kernel の `Chunk` を直接参照するメッシュ用ビューである:

```typescript
export type ChunkView = {
  readonly height: number
  readonly blocks: Readonly<Uint8Array>
  readonly fluid?: FluidView
}
```

`Chunk` を所有するのは mc-kernel（plan.md §3.1: 「`Chunk` データ構造とコーデック」）であり、
mc-meshing は `@nerima-games/mc-kernel` に依存する。メッシュ処理は `height` を使って
インデックスを計算するため、高さを固定値へ変換したり暗黙に切り詰めたりゼロ埋めしたりしない。

### 3.2 `FluidView` —— **バイトではなく復号済みの状態**を受け取る

```typescript
export type FluidView = {
  readonly levels: Readonly<Uint8Array>
  readonly sources: Readonly<Uint8Array>
  readonly falling?: Readonly<Uint8Array>
}
```

`FluidView` は upstream simulation が復号した state を受け取る現在の入力契約である。

`ChunkView` は参照実装と**同じ形**（`blocks: Uint8Array`）を宣言している。
`FluidView` は**わざと違う形**を宣言している —— 参照実装が渡すのは 1 本の
`fluid: Uint8Array` であり、それを 5 つのマスク（`packages/block/domain/fluid.ts:7-11`）で
復号する。**そのマスクを所有しているのは流体シミュレーション側であって、ここではない**ので、
ここで宣言すればロスターに 2 つ目の綴りが増える（責務表 §3.3 / §3.4 / M-11 が
座標・LOD 距離・レールの形状についてそれぞれ拒否したのと同じ形）。

したがって:

| | `ChunkView.blocks` | `FluidView` |
| --- | --- | --- |
| 参照実装の形 | 同一 | **意図的に別** |
| 差し替え時に起きること | kernel の `Chunk` を同じレイアウトで直接消費 | **符号化の所有者が publish した復号関数を呼ぶ層が要る** |
| その層の置き場所 | mc-meshing（kernel の `Chunk` を消費する境界） | mc-render（両方に依存する側）。責務表 §3.6 (c) |

**mc-meshing 側は差し替え時も変わらない。** ここが要求しているのは
「セルごとの level / source / optional falling」であって「どう詰められていたか」ではないので、
所有者が publish したときに書かれるのは `Uint8Array` → `FluidView` の変換 1 つであり、
それは `decodeFluidByte` を**所有者から import して**書かれるべきものである。

`maxLevel`（水 7 / 溶岩 3、`fluid-model.ts:15-16`）も同じ理由でここには無く、
`MeshConfig.fluidMaxLevels` として注入される。差し替え時にはその値も所有者から来る。

## 4. plan.md の数値の訂正（実測で検証）

| plan.md の記述 | 実測 |
| --- | --- |
| meshing 3 ファイル計 3,994 LOC | 名指し 3 ファイル = **343**、モジュール全体（23 ファイル）= **3,830**。3,994 は再現不能 |
| `transparentBlockIds: Set<number>` はネイティブ `Set` | **正しい**。ただし正確な型は `ReadonlySet<number>`（`greedy-meshing.ts:64`）。`HashSet` はメッシングコードに 1 件も無い |
| ~40 万 call/chunk | **正しい**。ただしコメントの帰属先は透過集合の lookup ではなく「内側の mask 構築ループ」（`greedy-meshing-passes.ts:105`）。6 パス × 16×16×256 = 393,216 |

`design-notes.md` M-1 に詳細。

## 5. 参照実装の Three.js 分離（検証済み）

plan.md §3.7 の「参照実装は THREE.js import ゼロを実測確認済み」を再検証した:

```console
$ rg -c "from ['\"]three" packages/world -t ts | wc -l
0
```

`packages/world/package.json` の依存は `@ts-minecraft/core` / `block` / `entity` /
`inventory` / `worker` / `effect` のみで、`three` は無い。

補強証拠: `packages/world/domain/voxel-raycast.ts:3` は
`// Voxel ray traversal (Amanatides & Woo). Replaces three.js Raycaster for block` と書いており、
Three.js への依存をわざわざ避けた履歴が残っている。

**mc-meshing はこの分離を 1 段下で維持する**（`responsibility.md` §3.1）。

## 6. 移植すべきテスト資産

plan.md §6 Step 2 は「各 Step で参照実装の対応テスト・fixture・E2E シナリオを
オラクルとして移植する」と定める。mc-meshing に対応するもの:

| 参照実装のテスト | LOC | 内容 | 本リポジトリでの扱い |
| --- | --- | --- | --- |
| `packages/rendering/test/greedy-meshing-efficiency.test.ts` | 59 | 配列長の整合、index/vertex 比、**16×16 平板がちょうど 6 quad**（:32）、1 層の面数上限 1536（:55） | 面数テストとして移植済み（16×16 平板は 6 quad） |
| `packages/rendering/test/greedy-meshing-advanced.test.ts` | 304 | 透過振り分け: 単一 WATER が `result.water` に行く（:33）、既定の空 Set では行かない（:80） | 移植済み |
| `packages/rendering/test/greedy-meshing-water.property.test.ts` | 116 | 空の `transparentBlockIds` で水が opaque に行く（:93）、全石チャンクで水メッシュが空（:111） | 移植済み |
| `packages/rendering/test/greedy-meshing.test.ts` | 449 | index の妥当性（:82）、単一ブロックの quad 数 < 18（:101）、頂点ごとの法線成分（:245-247） | ドメインの面・頂点・法線テストとして移植済み。GPU 用頂点バッファは mc-render の責務 |
| `packages/rendering/test/greedy-meshing.property.test.ts` | 265 | fast-check。index 範囲不変条件（:63, :92, :206） | fast-check による不変条件テストとして移植済み |
| `packages/rendering/test/greedy-meshing-passes.test.ts` | 130 | `dequantLight`、`packMask` のビット配置、`runGreedyExpansion` のマージ / 消費意味論 | マージと消費意味論はドメイン実装・テストへ移植済み。量子化ライト／マスク packing は mc-render の責務 |
| `packages/rendering/test/greedy-meshing-boundary.test.ts` | 66 | 境界 | 移植済み（形は違う） |
| `packages/worker/test/meshing-worker-config.test.ts` | 123 | `TRANSPARENT_IDS` に WATER、`TRANSPARENT_SOLID_IDS` に GLASS/LEAVES、**WATER を含まないこと**（:69） | 移植済み（レイヤ振り分けテストとして） |
| `greedy-meshing-ao.test.ts` / `-accumulator.test.ts` / `-colors.test.ts` / `-fluid-*.test.ts` / `-pool.test.ts` | 636 | AO / アキュムレータ / 色 / 流体 / プール | AO・流体・特殊形状は移植済み。アキュムレータ／色／プールは mc-render の責務 |
| `chunk-mesh*.test.ts` / `block-mesh.test.ts` / `lod-simplification*.test.ts` / `subregion-greedy*.test.ts` | — | Three.js 依存または帰属先が別 | mc-render の責務 |

共有 fixture: `packages/rendering/test/greedy-meshing-test-utils.ts`（102 行）に
`makeChunkWithBlock` / `makeChunkWithBlocks` / `ZERO_COORD` / `ZERO_OFFSET` がある。
本リポジトリの `test/mesh.test.ts` の `chunkWith` が同等物である。

`chunk-mesh-geometry.ts` に対応するテストファイルは参照実装に**存在しない**。
