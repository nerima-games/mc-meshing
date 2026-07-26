# 移植元と実測 LOC

- 参照実装ルート: `/Users/take/ghq/github.com/takeokunn/ts-minecraft`（以下パスはこれ相対）
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
| `lod-simplification.ts` | 288 | 帰属未定（`responsibility.md` §3） |

## 2. 移植したファイルの対応

| 参照実装 | 本リポジトリ | 備考 |
| --- | --- | --- |
| `worker/.../meshing-worker-config.ts:7-13`（2 つの透過集合） | `domain/opacity.ts` の `MeshConfig` | boolean ではなく三値の `MeshLayer` としてモデル化（`design-notes.md` M-3） |
| `rendering/.../greedy-meshing.ts:41-57`（`buildLookup` + `WeakMap`） | `domain/opacity.ts` の `buildLayerLookup` | `WeakMap` メモ化は未実装。config は呼び出し側が保持する想定 |
| `rendering/.../greedy-meshing-passes.ts:148-152`（振り分け優先度） | `domain/opacity.ts` の `layerOfBlockId` | 入れ子三項 → 値としての `MESH_LAYER_PRIORITY` |
| `rendering/.../greedy-meshing.ts:122-128`（面パスの呼び出し順） | `domain/faces.ts` の `FACES` | 順序を値として固定 |
| `rendering/.../greedy-meshing-algorithms.ts` の各法線・role | `domain/faces.ts` の `FACES` | 表は `public-api.md` §3 |
| `rendering/.../greedy-meshing-ao.ts:6-9`（`getBlock`） | `domain/chunk-view.ts` の `getBlock` | 3 つの性能例外そのまま（`design-notes.md` M-2） |
| `rendering/.../greedy-meshing-ao.ts:8`（ストレージレイアウト） | `domain/chunk-view.ts` の `blockIndex` | **同一**。参照実装の fixture 互換のため |
| `rendering/.../greedy-meshing-types.ts:40`（`AIR = 0`） | `domain/chunk-view.ts` の `AIR` | 同一 |

## 3. `ChunkView` について

`domain/chunk-view.ts` の `ChunkView` は**ローカルな構造型**である:

```typescript
export type ChunkView = { readonly blocks: Readonly<Uint8Array> }
```

本来 `Chunk` を所有するのは mc-kernel（plan.md §3.1: 「`Chunk` データ構造とコーデック」）だが、
まだ publish されていないので、メッシングが必要とする最小の形だけを宣言してある。

mc-kernel が publish されたら、この型を kernel の `Chunk` に差し替える。
構造型なので、kernel の `Chunk` が `blocks: Uint8Array` を持つ限り互換である。

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
| `packages/rendering/test/greedy-meshing-efficiency.test.ts` | 59 | 配列長の整合、index/vertex 比、**16×16 平板がちょうど 6 quad**（:32）、1 層の面数上限 1536（:55） | 面数テストとして移植済み（マージ未実装なので「6 quad」だけ未達） |
| `packages/rendering/test/greedy-meshing-advanced.test.ts` | 304 | 透過振り分け: 単一 WATER が `result.water` に行く（:33）、既定の空 Set では行かない（:80） | 移植済み |
| `packages/rendering/test/greedy-meshing-water.property.test.ts` | 116 | 空の `transparentBlockIds` で水が opaque に行く（:93）、全石チャンクで水メッシュが空（:111） | 移植済み |
| `packages/rendering/test/greedy-meshing.test.ts` | 449 | index の妥当性（:82）、単一ブロックの quad 数 < 18（:101）、頂点ごとの法線成分（:245-247） | **一部**。頂点バッファ未実装 |
| `packages/rendering/test/greedy-meshing.property.test.ts` | 265 | fast-check。index 範囲不変条件（:63, :92, :206） | **一部**。同上 |
| `packages/rendering/test/greedy-meshing-passes.test.ts` | 130 | `dequantLight`、`packMask` のビット配置、`runGreedyExpansion` のマージ / 消費意味論 | **未**。マージ実装と同時 |
| `packages/rendering/test/greedy-meshing-boundary.test.ts` | 66 | 境界 | 移植済み（形は違う） |
| `packages/worker/test/meshing-worker-config.test.ts` | 123 | `TRANSPARENT_IDS` に WATER、`TRANSPARENT_SOLID_IDS` に GLASS/LEAVES、**WATER を含まないこと**（:69） | 移植済み（レイヤ振り分けテストとして） |
| `greedy-meshing-ao.test.ts` / `-accumulator.test.ts` / `-colors.test.ts` / `-fluid-*.test.ts` / `-pool.test.ts` | 636 | AO / アキュムレータ / 色 / 流体 / プール | **未**。対応機能が未実装 |
| `chunk-mesh*.test.ts` / `block-mesh.test.ts` / `lod-simplification*.test.ts` / `subregion-greedy*.test.ts` | — | Three.js 依存または帰属先が別 | mc-render の責務 |

共有 fixture: `packages/rendering/test/greedy-meshing-test-utils.ts`（102 行）に
`makeChunkWithBlock` / `makeChunkWithBlocks` / `ZERO_COORD` / `ZERO_OFFSET` がある。
本リポジトリの `test/mesh.test.ts` の `chunkWith` が同等物である。

`chunk-mesh-geometry.ts` に対応するテストファイルは参照実装に**存在しない**。
