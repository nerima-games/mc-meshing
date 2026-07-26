# 責務

- 出典: `/Users/take/Documents/plan.md` §3.3
- 参照実装: `takeokunn/ts-minecraft`

## 1. plan.md §3.3 の記述（原文）

> ### 3.3 mc-meshing
>
> - **責務**: チャンクデータ→ジオメトリバッファの純粋変換（グリーディメッシング）
> - **依存**: kernel（Chunk型・能力フラグ）
> - **主要な公開API**: `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}`（優先度 transparentSolid > water > opaque）。透過ブロック集合は `config` で注入（参照実装の `transparentBlockIds` 方式を踏襲）
> - **検証**: ゴールデンテスト（chunk fixture → バッファのハッシュ比較）+ 性質テスト（面数上限、隣接チャンク境界の整合）
> - **移植元**: greedy-meshing.ts + chunk-mesh-geometry + meshing-worker-config.ts（計 3,994 LOC）
> - **設計注意**: ホットパスの `transparentBlockIds: Set<number>` はネイティブ `Set` を維持（**~40万call/chunk**。Effect の HashSet は構造的等価性比較が遅く使用禁止）。`getBlock()` は境界チェックをインライン化し Option 割り当てを避ける（いずれも参照実装で実測確定）

## 2. 責務の言い換え

**ブロック ID の配列と注入された設定だけを入力とし、3 つの面リストを返す純粋関数。**

- 三値の不透明度モデル（`opaque` / `water` / `transparentSolid`）とその優先度
- 正準な面方向順序（+X, -X, +Y, -Y, +Z, -Z）
- 遮蔽判定（どのレイヤが隣接面を隠すか）
- チャンク境界の扱い（隣接チャンク未ロード時の規約）
- ホットパスのブロック読み出し（`getBlock`）
- **グリーディマージ（未実装。このリポジトリの本体）**

## 3. 明示的にスコープ外のもの

| 項目 | どこが所有するか | 理由 |
| --- | --- | --- |
| **Three.js のあらゆる型** | mc-render | typed array を `BufferGeometry` にするのはレンダラの仕事。§3.1 |
| マテリアル（水シェーダ・アトラス・アルファブレンド） | mc-render | 「どう描くか」は「どこに面があるか」とは別 |
| どのブロックが水 / ガラスか | mc-kernel（能力フラグ）+ 消費側 | `config` で注入する。§3.2 |
| チャンクのロード / アンロード / dirty 管理 | mc-worldgen（`ChunkManager`） | plan.md §3.7 |
| メッシュ更新の発火（dirty 購読） | mc-render（`WorldRenderer`） | plan.md §3.9 |
| ワーカープールの実装 | mc-render | plan.md §3.9。mc-meshing は worker の中で**呼ばれる**側 |
| ライトグリッド（BFS 光伝播）の**生成** | mc-worldgen | plan.md §3.7。mc-meshing は読むだけ（現時点では未対応） |
| LOD 簡約 | 未定 | 参照実装の `lod-simplification.ts`（288 LOC）。距離の概念が要るので mc-render 寄りかもしれない |
| アンビエントオクルージョン | 保留 | 参照実装の `greedy-meshing-ao.ts`（149 LOC）。メッシュに焼き込む以上ここだが、まず基本を固める |
| 植生メッシュ（十字板） | 保留 | 参照実装の `plant-mesh.ts`（258 LOC） |
| 流体の高さ / 流れ方向 | 保留 | 参照実装の `greedy-meshing-fluids.ts` + `-fluid-state.ts`（385 LOC）。流体伝播ルール自体は mx-gameplay |

### 3.1 Three.js 非依存は絶対条件

参照実装は `packages/world` の Three.js import をゼロに保っており、plan.md §3.7 が
「参照実装は THREE.js import ゼロを実測確認済み — この分離を維持する」と明記している
（本リポジトリでも再検証済み: `porting.md` §5）。

mc-meshing はその分離を**1 段下で**維持する。理由は 2 つ:

1. メッシングは production では **Web Worker の中で**走る。Worker には DOM も WebGL コンテキストもない。
2. テストは Node で走る。同じコードが両方で動かなければならない。

`tsconfig.base.json` の `"lib": ["ES2024"]` / `"types": []` がこれを型レベルで強制している。

### 3.2 透過集合を注入する理由

「どのブロックが水で、どのブロックがガラスか」を知っているのは**ブロックテーブルの所有者**であり、
メッシャではない。注入にしておけば:

- mc-meshing はブロックテーブルの所有者を知らずに済み、依存グラフに余計な辺が生えない
- テストが任意のブロック ID を使える（本リポジトリのテストは `STONE=1, WATER=2, GLASS=3` を使う）
- 将来リソースパックでブロックの透過性を差し替えても mc-meshing は変わらない

参照実装も同じ設計である（`greedy-meshing.ts:64, 67` で引数として受け取る）。

## 4. 親と子

| 関係 | リポジトリ |
| --- | --- |
| 親（依存先） | `mc-kernel` のみ |
| 子（依存元） | `mc-render` のみ |

現時点では `mc-kernel` すら `package.json` に入っていない（まだ publish されていないため）。
`architecture.md` §7 を参照。

`domain/chunk-view.ts` の `ChunkView` は**ローカルな構造型**である。
本来 `Chunk` を所有するのは mc-kernel（plan.md §3.1）だが、まだ publish されていないので
メッシングが必要とする最小の形だけを宣言してある。
mc-kernel が publish されたら 1 行の差し替えで済む（`porting.md` §3）。

## 5. 完成条件

`testing.md` §4 に詳細。要約:

- ゴールデンテスト（chunk fixture → バッファのハッシュ比較）
- 性質テスト（面数上限、隣接チャンク境界の整合）
- **グリーディメッシングの実装**（現在は素朴な面抽出のみ）

mc-meshing は**プレビューを持たない**。安定ライブラリ層は操作できる成果物を持たない。
メッシュを目視確認するのは mc-render の内蔵ビューア（plan.md §3.9）である。
