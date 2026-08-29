# 責務

- 出典: plan.md（**非公開**）§3.3
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

**ブロック ID の配列と注入された設定だけを入力とし、3 つのキューブ面リストと形状別の専用リストを返す純粋関数。**

- 三値の不透明度モデル（`opaque` / `water` / `transparentSolid`）とその優先度
- 正準な面方向順序（+X, -X, +Y, -Y, +Z, -Z）
- 遮蔽判定（どのレイヤが隣接面を隠すか）
- チャンク境界の扱い（隣接チャンク未ロード時の規約）
- ホットパスのブロック読み出し（`getBlock`）
- **グリーディマージ（実装済み。このリポジトリの本体）** —— `domain/mesh.ts`。
  同一スライス・同一方向・同一 `blockId` **かつ同一 `ao`** の面を最大矩形にまとめる。
  素朴実装は `meshChunkNaive` としてオラクル用に残してある（`testing.md` §2）
- **アンビエントオクルージョン（実装済み）** —— `domain/ambient-occlusion.ts`。
  面ごとに 1 値 `[0, 3]`。面前の空気セルの接線 4 近傍のうち非 air の数。
  マージキーの一部である（`design-notes.md` M-10）
- **十字板の植生（実装済み）** —— `domain/plant-mesh.ts`。
  対角 2 枚の小数座標パネル。ブロック面ではないので `Quad` ではなく
  `MeshLayers.crossPlants` で運ぶ。どの ID が植物かは `config` で注入する（`design-notes.md` M-11）
- **流体の水面高と流れ方向（実装済み）** —— `domain/fluid-mesh.ts`。
  4 隅の Y が別々の小数なので `Quad` ではなく `MeshLayers.fluids` で運ぶ。
  水面の形は 4 隅の傾き、renderer 用の流れ方向は上面の正規化済み `FluidFlow.direction` で運ぶ。
  入力は復号済みの `FluidView`（level / source / optional falling）、`maxLevel` は `config` で注入する
  （`design-notes.md` M-12）
- **特殊形状（実装済み）** —— `domain/special-mesh.ts`。
  サボテン、レール、lily pad、固定 slab、pressure plate は `MeshLayers.specials` の専用形状として出力する。
  対応する render kind とブロック ID は `mc-kernel` のレジストリから `MeshConfig` に構築する。

## 3. 明示的にスコープ外のもの

| 項目 | どこが所有するか | 理由 |
| --- | --- | --- |
| **Three.js のあらゆる型** | mc-render | typed array を `BufferGeometry` にするのはレンダラの仕事。§3.1 |
| マテリアル（水シェーダ・アトラス・アルファブレンド） | mc-render | 「どう描くか」は「どこに面があるか」とは別 |
| どのブロックが水 / ガラスか | mc-kernel（能力フラグ）+ 消費側 | `config` で注入する。§3.2 |
| チャンクのロード / アンロード / dirty 管理 | mc-worldgen（`ChunkStore` = plan.md §3.7 の `ChunkManager`） | plan.md §3.7。実装済み |
| メッシュ更新の発火（dirty 購読） | mc-render（`WorldRenderer`）が mc-worldgen の `ChunkStore.subscribeDirty` を購読する | plan.md §3.9 |
| **座標の語彙**（`ChunkCoord` / チャンク座標系） | mc-kernel（型）+ mc-worldgen（キーとしての運用） | §3.3 |
| ワーカープールの実装 | mc-render | plan.md §3.9。mc-meshing は worker の中で**呼ばれる**側 |
| ライトグリッド（BFS 光伝播）の**生成** | mc-worldgen | plan.md §3.7。mc-meshing は光グリッドを生成・所有せず、mc-render がメッシュ後のサンプルと色合成を行う |
| **LOD 簡約**（`simplifyMesh` / `packQuadKey` / `LodLevel`） | **mc-meshing**（決着。§3.4。**実装済み**: `domain/lod.ts`） | 参照実装の `lod-simplification.ts` のうち約 240 LOC。`MeshLayers → MeshLayers` で、距離を 1 つも取らない。削減の実測は `design-notes.md` M-8 |
| **LOD 段の選択**（`lodForDistance` / `LOD*_DISTANCE_CHUNKS`） | **mc-render**（決着。§3.4） | 同ファイルの残り。プレイヤーのチャンクと対象チャンクの距離が要る = §3.3 が禁じているもの。**4 / 8 を正当化するために測るべきことは §3.5** |
| **`three` のジオメトリ / マテリアル生成**（`block-mesh.ts` 91 LOC） | **mc-render**（決着。§3.4） | `import * as THREE` が 8 箇所。本リポジトリは `three` に依存しない |
| **アンビエントオクルージョン** | **mc-meshing**（決着。**実装済み**: `domain/ambient-occlusion.ts`） | 参照実装の `greedy-meshing-ao.ts` 149 LOC のうち **AO の半分**（`aoXPos` .. `aoZNeg`、:15-87）。「まず基本を固める」の基本＝グリーディマージは着地した（M-9）ので保留の理由は消えた。**面ごとに 1 値**（頂点ごとではない。参照実装がそうである根拠は M-10）で、**マージキーに入る**。残り半分の光サンプリング（:95-149）は `LightGrids` を読むので**移植していない** —— 下の「ライトグリッド」の行に従う |
| **植生・特殊形状** | **mc-meshing**（決着。**実装済み**: `domain/plant-mesh.ts`, `domain/special-mesh.ts`） | 十字板、lily pad、cactus、rail を専用 `Quad` として出力する。レールの向きや傾斜は kernel のブロック能力に含まれないため、現行の形状は方向に依存しない基本形状とする |
| **slab / pressure plate / stairs の描画形状** | **mc-meshing（kernel の能力表を入力にする）** | 状態を持たない slab は半ブロック、pressure plate は 1/16 inset・1/16 high の固定形状を出力する。stairs、レールの向き、slab の上下、pressure plate の押下状態は kernel が block state / 描画契約を公開していないため未実装。`collisionShape` 全体を描画形状と推測しない |
| 流体の高さ / 流れ方向 | **mc-meshing**（決着。**実装済み**: 公開入口 `domain/fluid-mesh.ts`、状態 `domain/fluid-state.ts`、頂点生成 `domain/fluid-geometry.ts`） | 参照実装の `greedy-meshing-fluids.ts` + `-fluid-state.ts`（385 LOC）のうち**ジオメトリの側**。流体伝播ルール自体は mx-gameplay であり、そこは動いていない。**保留の理由だった「入力が無い」は、入力の継ぎ目を*復号済みの状態*に引いて解いた** —— バイト符号化ではなく `FluidView`（セルごとの level / source / optional falling）を受け取り、水面形状と renderer 向け `FluidFlow` を出すので、5 つのマスクの 2 つ目の綴りはここに生まれない。`maxLevel`（水 7 / 溶岩 3）は伝播の性質なので `MeshConfig.fluidMaxLevels` で注入する。詳細と決着の内容は §3.6 |

### 3.3 このリポジトリは座標を持たない（意図的）

`ChunkNeighbours`（`domain/chunk-view.ts`）は軸方向 4 つと対角方向 4 つの optional な `ChunkView` であり、
「どの `ChunkView` がどの隣接チャンクか」を決める座標はここに無い。
縦切りスパイクはこれを穴として指摘した — 座標をキーにしたストアから
`ChunkNeighbours` を埋めるには、呼び出し側が手でルックアップすることになる、と。

**決着: 座標はここに入れない。ルックアップはキーを所有する側が持つ。**

`mc-worldgen` の `ChunkStore.neighbours(coord)` がルックアップを行い、
`{ xPos?, xNeg?, zPos?, zNeg?, xPosZPos?, xPosZNeg?, xNegZPos?, xNegZNeg? }` を返せる。
対角 4 つは AO と流体の角サンプル用で optional のため、軸方向 4 つだけを返す既存実装も本リポジトリの
`ChunkNeighbours` に**構造的に**適合する（mc-worldgen は mc-meshing を import できない —
そのエッジは plan.md §2.1 のグラフに無く、mc-worldgen 側の `oxlint.json` の
`no-restricted-imports` が落とす — ので名前的な適合ではない）。
両方に依存する mc-render がそのまま渡す。

理由は 2 つ。

1. **本リポジトリは純粋関数の集合であり、`mesh(chunk, neighbours, config)` は
   バッファしか見ない。** 座標を入れると「どのチャンクか」という第 2 の変更理由が増える。
2. **座標系は mc-kernel の資産である**（plan.md §3.1: `Position` / `AABB` / チャンク座標系）。
   ここで `ChunkCoord` を宣言すれば、ロスターに 3 つ目の綴りが増える。
   2 つ目（mc-worldgen の `{x, z}`）は kernel の `{cx, cz}` に統合されたばかりである。

将来 mc-kernel を消費するようになったら、必要なら kernel の `ChunkCoord` を
そのまま使う。本リポジトリ独自の座標型を作ることはしない。

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

### 3.4 決着: LOD の 379 LOC はどこへ行くか

`mc-render/docs/porting.md` が「移植時に確定させ」と保留していた 379 LOC
（`lod-simplification.ts` 288 + `block-mesh.ts` 91）の行き先を確定させる。

**`lod-simplification.ts` は 1 ファイルだが関心が 2 つ入っており、それが「未定」の正体だった。**
この表の旧記述は「距離の概念が要るので mc-render 寄りかもしれない」と書いていたが、
それは**半分だけ正しい**。実際に距離を取る関数は 1 つしかない。

| 記号 | 引数 → 戻り値 | 距離を取るか | 行き先 |
| --- | --- | :-: | --- |
| `simplifyMesh` | `(MeshedChunk, LodLevel) → MeshedChunk` | **取らない** | mc-meshing（移植済み。本リポジトリでは `(MeshLayers, LodLevel) → MeshLayers`） |
| `packQuadKey` / `LodLevel` / `LOD_LEVELS` / `LodLevelSchema` | 語彙 | 取らない | mc-meshing |
| `lodForDistance` | `(distanceChunks: number) → LodLevel` | **取る** | mc-render |
| `LOD1_DISTANCE_CHUNKS` / `LOD2_DISTANCE_CHUNKS` | 定数（4 / 8 チャンク） | 距離そのもの | mc-render |

**決め手は §3.3 である。** 「本リポジトリは座標を持たない」は既に決着済みのルールであり、
`lodForDistance` の `distanceChunks` は「プレイヤーのチャンクと対象チャンクの
L1 / L∞ ノルム」——参照実装の doc comment がそう書いている——つまり座標の派生物である。
これを入れれば §3.3 が禁じた「どのチャンクか」という第 2 の変更理由がそのまま入ってくる。
逆に `simplifyMesh` は `MeshedChunk` と段番号しか見ない。**`mesh()` と同じ形の純粋関数である。**

`block-mesh.ts` は迷う余地が無い。`import * as THREE` があり THREE の参照が 8 箇所、
`MaterialCacheKey` を持つ `Effect.Service` である。本リポジトリが `three` に依存した瞬間、
`package.json` の 「Pure chunk-data -> geometry-buffer conversion」 という説明が嘘になる。

**この分割が有効なのは、`LodLevel` の語彙を mc-meshing が所有するからである。**
mc-render は「どの段か」を決め、mc-meshing は「その段が何を意味するか」を決める。
`ChunkStore.neighbours` と `ChunkNeighbours` が §3.3 で分かれているのと同じ形であり、
本リポジトリが座標を持たないまま距離依存の機能を提供できる理由でもある。

なお参照実装のファイル名ヒューリスティック（`mesh|greedy` にマッチ）は
`lod-simplification.ts` を**取りこぼす**。`mc-render/docs/porting.md` §1.3 がその
2,807 / 2,993 / 3,095 の食い違いを記録している。ファイル名で責務を推測すると
288 LOC が静かに落ちるという実例である。

### 3.5 mc-render へ: `LOD1_DISTANCE_CHUNKS = 4` と `LOD2_DISTANCE_CHUNKS = 8` を正当化するために測るべきこと

§3.4 の分割にしたがって `simplifyMesh` 側は移植・計測済みである（`design-notes.md` M-8）。
残る 2 つの定数は mc-render のものだが、**参照実装でもこのプロジェクトでも一度も測られていない。**
本リポジトリでは測れない —— 視距離における見た目の誤差の話であり、ここには視点が無い。
**測れないが、何を測るべきかは正確に書ける。** 以下がその欠けている測定である。

#### (a) 欠けている測定そのもの: 段を切り替えたときの**画面上の**ずれ

`simplifyMesh` が動かす量は厳密に分かっている。境界は grid に外向きに丸められるので、
1 本の辺が動く最大距離は **`step - 1` ブロック**である（LOD 1 で 1、LOD 2 で 3）。
Y は動かないので、**動くのは水平方向だけ**である。

これを画面に投影する式は初等的である（垂直 FOV、ビューポート高 `H` px、
チャンク 1 = 16 ブロック、距離 `d` チャンク）:

```
ずれ[px] = (step - 1) / (16 * d) * H / (2 * tan(fov_v / 2))
```

参照実装の既定値（`settings.schema.ts:53` の `fov: 75`、1080p）を入れると:

| 段 | 動く量 | 発火距離 | その距離でのずれ | ずれが 1 px を切る距離 |
| --- | ---: | ---: | ---: | ---: |
| LOD 1 | 1 ブロック | 4 チャンク | **約 11 px** | 約 44 チャンク |
| LOD 2 | 3 ブロック | 8 チャンク | **約 16 px** | 約 132 チャンク |

参照実装の `lod-simplification.ts:23-25` は自分の閾値について
「at distance >= LOD1_DISTANCE chunks the camera is far enough that any z-fighting /
cracks become a sub-pixel artifact at typical FOVs」と書いている。
**この式に照らすと桁が 1 つ違う。** 4 チャンクでの LOD 1 のずれは sub-pixel ではなく
約 11 px であり、sub-pixel になるのは 44 チャンク付近である
（`renderDistance` の既定は 8 なので、そこまで遠いチャンクは**そもそも存在しない**）。

したがって **mc-render が測るべきなのは「ずれが sub-pixel か」ではない** ——
それは既に否定できる。測るべきは
**「プレイヤーが気づかない最大のずれは何 px か」**である。
これは知覚の量であって計算では出ず、実測が要る。手順は:

1. 同じチャンクを LOD 0 と LOD n で描き、距離を変えながら A/B で切り替える
2. 「切り替わったことに気づいた距離」を記録する（複数人、複数地形）
3. その距離を上式に入れて閾値 px を得る
4. その px を上式で `d` に解き直したものが `LOD1_DISTANCE_CHUNKS` の**測定された**値になる

上の表の「1 px を切る距離」列がその上界である。現行の 4 / 8 は、
測定された値ではなく**それ以外の何か**（おそらく描画コスト）で決まっている。
それ自体は正当な決め方だが、**そう書かれていない**ことが問題である。

#### (b) 定数が**何を買っているか**: 本リポジトリの実測が言えること

M-8 の削減率（opaque quad 数、素朴メッシャ）に、L∞ 距離のリング構成を掛けると:

| `renderDistance` | LOD 0 のチャンク | LOD 1 | LOD 2 | rolling 地形での quad 削減 |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 49 / 81 | 32 / 81 | **0 / 81** | **-18.1%** |
| 8 | 49 / 289 | 176 / 289 | 64 / 289 | -43.0% |

**`renderDistance = 4` では `LOD2_DISTANCE_CHUNKS = 8` は一度も発火しない。**
`d < 8` を満たさないチャンクが存在しないからである。
`renderDistance = 4` は参照実装の adaptive quality が低品質時に落とす先であり
（`frame-runtime-logic.test.ts:212-213`）、本リポジトリのベンチが load 時間の枠として
使っている設定でもある。**最も描画が苦しい設定で、最も強い LOD 段が死んでいる。**
これは知覚の測定を待たずに直せる欠陥であり、閾値を `renderDistance` に対する
比で持つべきだという主張の根拠になる（例: `LOD1 = R/2`, `LOD2 = R`）。

#### (c) 上の数字は**上限だった**。グリーディ着地後に取り直した結果、予想は当たった

旧記述はこう書いていた —— 「本リポジトリのメッシャは素朴で quad はすべて 1x1 である。
これは LOD が最も稼げる入力であり、グリーディマージが着地すれば平坦面は 1 枚にまとまって
snap しても衝突相手がいなくなる。**上の -18.1% / -43.0% は上限であって、実装後の値ではない。**
… **もしグリーディマージ後に LOD 1 の削減が数 % まで落ちるなら、4 チャンクという閾値は
約 11 px の見た目の誤差を払って何も買っていないことになり、定数どころか LOD 1 段そのものが疑わしい。**
M-8 の表をグリーディ着地後に取り直すこと」。

**マージは着地し、表は取り直した。予想された事態がそのまま起きている。**

`simplifyMesh` の削減率（opaque quad 数）、素朴メッシュ 対 マージ済みメッシュ:

| fixture | LOD 1（素朴） | LOD 1（マージ後） | LOD 2（素朴） | LOD 2（マージ後） |
| --- | ---: | ---: | ---: | ---: |
| flat | -52.8% | **-0.0%** | -77.1% | **-0.0%** |
| rolling | -45.9% | **-2.9%** | -68.0% | **-9.5%** |
| checkerboard-worst | -16.7% | -16.7% | -62.5% | -62.5% |
| layered-water-glass | -53.4% | **-0.0%** | -77.5% | **-0.0%** |

理由は機構的であって不具合ではない。簡約は quad を粗い格子に snap し、**一致したものを捨てる**ことで
減らす。マージ済みメッシュでは平坦な走りがすでに 1 枚にまとまっているので、
**一致する相手が残っていない**。flat の上面は 16x16 の quad 1 枚で、すでに 4 格子に整列しており、
snap しても原点も範囲も動かない。checkerboard だけ数字が変わらないのは、そこでは
マージが 1 つも起きず、入力が素朴メッシュそのままだからである。

(b) のリング加重を同じ式で引き直すと:

| `renderDistance` | rolling の quad 削減（素朴） | rolling（マージのみ） | rolling（マージ + AO） |
| ---: | ---: | ---: | ---: |
| 4 | -18.1% | **-1.2%** | **-3.1%** |
| 8 | -43.0% | **-3.9%** | **-8.8%** |

**したがって (c) が条件付きで述べていた結論は、いまや条件が満たされている。**
`renderDistance = 4` で LOD 1 が買うものは quad の数 % であり、その代金は
(a) の式による**約 11 px の水平方向のずれ**である。これは「定数 4 が間違っている」という話ではなく、
**LOD 1 という段そのものが、マージ済みメッシュに対しては割に合わない**という話である。

#### (c') アンビエントオクルージョンが着地して、この数字は**上向きに**動いた

第 3 列は AO 導入後（`design-notes.md` M-10）である。AO はマージキーに入るので
陰影の違う面が割れ、rolling のマージ済み quad は 768 → 960 に増え、
**簡約が拾える相手が戻ってきた**。`renderDistance = 4` での取り分は 1.2% → **3.1%**、
`renderDistance = 8` では 3.9% → **8.8%** である。

**結論の向きは変わらないが、強さは変わる。** 3.1% は 1.2% よりは買い物らしいが、
それでも約 11 px のずれの代価としては薄い。そして重要なのは**この動きの意味**である:
M-8 が引いていた参照実装のプロパティテストは「一様な光の下ではグリーディが平面を 1 枚にまとめるので
LOD は何も回収できない。ライティングで面が割れて初めて効くようになる」と述べていた。
AO はライティングそのものではないが、面を割るという一点で同じ働きをしており、
**予告どおりの向きに数字を動かした**。したがって本当のライティング（`LightGrids`。§3 により
mc-worldgen の所有）が入れば、この列はさらに上がる。

**mc-render への含意はこうなる:** LOD 1 の値打ちは固定値ではなく、
**メッシュがどれだけ細かく割れているかの関数**である。
マージだけの状態で測った 1.2% はその下限であって、mc-render が最終的に受け取る値ではない。
閾値を決めるのは (a) の知覚の測定であるという結論は変わらないが、
**その測定はライティング着地後に行うべきである** —— それ以前に測ると、
段が買うものを最も少なく見積もった状態で閾値を固めることになる。

これは mc-render の判断であってこちらの判断ではない（段を選ぶのは §3.4 により mc-render）。
こちらから言えるのは測った数字までである。ただし 1 つだけ補足しておく:
**この結論は `simplifyMesh` の現在の機構 —— snap して一致を捨てる —— に固有である。**
snap 後の quad を捨てるのではなく**併合する**簡約であれば、マージ済みメッシュからも
まだ取れるものがある（例: rolling の 768 枚は、粗い格子上ではさらにまとまりうる）。
それは `lod-simplification.ts` の移植ではなく別物の設計であり、ここでは行っていない。

#### (d) 費用の側

`simplifyMesh` はメッシングと同じ桁の費用がかかり、checkerboard では 2.9 倍である
（M-8 の費用表）。**段の切り替えはフレームごとに走らせてよい処理ではない。**
段が変わったチャンクについて 1 回だけ走らせ、結果を保持すること。
mc-render が測るべき 3 つ目は、プレイヤーの通常の移動速度で**毎秒何チャンクが段をまたぐか**である。

### 3.6 流体メッシュ —— 保留の理由は「入力が無い」であり、入力の継ぎ目を引いて解いた

AO（M-10）と十字板（M-11）は保留を解いた。**流体は、その時点では解かなかった。**
理由は作業量ではなく、決着していない所有権が 1 つ残っていたことである。
**それを決着させたので、以下は「なぜ保留だったか」と「どう引いたか」の記録である。**

#### (a) 争いが無かった側 —— メッシュはここのもの

責務表の行が自分で述べているとおり、mx-gameplay のものは**伝播ルール**
（どのセルにどれだけ流体が来るか）であって、
**水面の高さと側面の形をジオメトリにすること**ではない。ここに争いは無く、**この線は動かしていない。**
`domain/fluid-mesh.ts` には流体がどこへ広がるかを決めるコードは 1 行も無い。

#### (b) 争いがあった側 —— 入力

参照実装の `resolveFluidState`（`greedy-meshing-fluid-state.ts:45-72`）は
`blocks` に加えて**第 2 の配列** `fluid: Uint8Array` を読み、
それを `decodeFluidByte`（`packages/block/domain/fluid.ts:22-30`）で復号する。
その符号化は 5 つのマスク定数である（同 :7-11）:

| ビット | 意味 |
| --- | --- |
| `0x80` | セルに流体があるか |
| `0x10` | `lava` か `water` か |
| `0x08` | 水源か |
| `0x07` | レベル（0-7） |

**この符号化を所有しているのは流体シミュレーション側であり、mc-meshing ではない。**
ここで 5 つのマスクを宣言すれば、**もう 1 つの綴り**がロスターに増える ——
§3.3 が座標について、§3.4 が LOD 距離について、M-11 がレールの形状について
それぞれ拒否したのと**同じ形の誤り**である。

#### (c) どう引いたか —— 継ぎ目を**バイトではなく復号済みの状態**に置いた

保留時に挙げていた選択肢は 2 つだった。(1) 符号化の所有者が決まって publish するのを待つ、
(2) `ChunkView` の前例にしたがい `fluid?:` を最小の構造型としてここに宣言する。
**取ったのは (2) だが、(2) を字義どおりに取ってはいない。**
`fluid?: Readonly<Uint8Array>` を宣言すれば配列は手に入るが、
**それを読むにはマスクが要る**ので、(b) の誤りをそのまま踏むことになる。

そこで継ぎ目を 1 段内側 ——**復号済みの状態**—— に引いた（`domain/chunk-view.ts` の `FluidView`）:

| 所有 | 内容 |
| --- | --- |
| シミュレーション側 | どのセルに流体があるか、どの種類か、**レベル**、**水源か**、**落下中か** |
| mc-meshing | レベル→水面高、4 隅の平均、水面高からの水平 flow、面の露出規則、側面の形 |

バイト配置についての合意が 1 つも要らなくなるので、**マスクはここに 1 つも現れない。**
5 ビットのうちここに来ないものにもそれぞれ理由がある:

- **present は冗長** —— セルに流体があるのは `MeshConfig.fluidMaxLevels` が宣言した ID のときであり、
  `blocks` が既に答えている。参照実装は両方を持っているので**突き合わせが要る**（同 :63）。
- **kind も冗長** —— ブロック ID がそのまま種類である。
- **maxLevel はセルごとではない** —— 流体ごと（水 7 / 溶岩 3、`fluid-model.ts:15-16`）であり、
  「どこまで広がるか」という**伝播の語彙**なので、`MeshConfig.fluidMaxLevels` で注入する。
  §3.2 が `waterBlockIds` について定めたのと同じ 3 つの理由である。

`FluidCell` / `FluidWorkItem` / `FluidKind` は流体の伝播規則を所有する `mx-gameplay` に属する。
この `FluidView` は gameplay の復号済み状態をメッシュ生成へ渡す geometry-neutral な入力境界であり、
メッシュ側は流体の伝播や tick scheduling を所有しない。

#### (d) 移植した中身と、その出典

| 要素 | 出典 | 状態 |
| --- | --- | --- |
| 水源の水面高 `14/16` | `greedy-meshing-fluid-state.ts:37` | **出典あり**（コメントに理由。岸辺がガラス壁に見えないため） |
| セルの高さ `max(1/(maxLevel+1), 1 - level/(maxLevel+1))` | 同 :39-43 | 出典あり。`maxLevel` は注入 |
| 4 隅の高さ = 周囲 2x2 列の平均 | 同 :89-113 | 出典あり。水面の幾何学的な傾きとして現れる |
| 上面の正規化 X/Z flow | 本実装の追加契約 | 同種流体の水面高の降下を 4 近傍で合成。段差は 1 段下の同種流体を確認し、未ロード境界は寄与させない |
| 同種流体が上にあれば高さ 1 | 同 :74-87 | 出典あり |
| 面の露出規則（ガラス越しの水槽は見える） | 同 :129-134 | 出典あり |
| 側面の下端が隣接流体の高さに合う | `greedy-meshing-fluids.ts:94-97` | 出典あり |
| 下面を含む 6 方向。下面は固体または流体で隠れる | 公式 `LiquidBlockRenderer` の方向別 face-culling 契約 | **実装済み** |

**そして流体 quad は `Quad` にはなれない** —— 4 隅の Y が別々の小数なので、
矩形記述子では表せない。十字板（M-11）と特殊形状で同じ境界を既に通しているため、`MeshLayers` に
専用リスト（`fluids`）が生えている。**ここは新しい API 形状ではない。**

**マージとの関係も同じ理由で決まる**（M-12）—— N セルをまとめた走りは辺ごとに N+1 個の隅の高さを持ち、
`Quad` には両端の 2 つぶんしか場所が無い。**マージは「高い」のではなく「表現できない」。**
参照実装も `addQuad` に幅・高さを `1, 1` で固定して渡している（`greedy-meshing-fluids.ts:56-57`）。

**被覆同値性（M-9）は形のまま生きている。** 両メッシャが同じように流体 ID を 6 パスから除外するので、
`meshChunk` と `meshChunkNaive` は同じブロック面の集合を見ており、「同じ面を覆う」の意味は変わっていない。

## 4. 親と子

| 関係 | リポジトリ |
| --- | --- |
| 親（依存先） | `mc-kernel` のみ |
| 子（依存元） | `mc-render` のみ |

`mc-kernel` の `Chunk` を `package.json` の依存として直接消費する。
`domain/chunk-view.ts` は kernel の `height` と `y + lz * height + lx * height * 16` の
レイアウトをそのまま扱う。高さを 256 に変換する境界や別のアダプターは存在しない。

## 5. 完成条件

`testing.md` §4 に詳細。要約:

- 決定論的ゴールデンテスト（ローカル chunk fixture → canonical `MeshLayers` JSON の SHA-256）—— **達成**（`test/mesh-golden.test.ts`、`test/golden/mesh-goldens.json`）。参照実装の chunk fixture と renderer の GPU buffer hash は外部連携の確認項目として未達 |
- 性質テスト（面数上限、隣接チャンク境界の整合）—— **達成**
- mc-kernel 登録ブロックの経路網羅 —— **達成**（`test/kernel-registry-coverage.test.ts`）。
  `BLOCK_IDS` 全件を `propertyOfBlockId` と照合し、メッシュ層・特殊形状・流体最大レベルを検証する。
- **グリーディメッシングの実装** —— **達成**。AO 着地後の現行値で flat -99.8%、rolling -82.7%、
  checkerboard 0.0%（マージできる対が 1 つも無い形なので、これが正しい値である）、
  layered -99.3%。被覆面積は 4 shape すべてで素朴実装と一致する。
  AO 導入前は rolling -86.2% / layered -99.7% であり、差は
  **陰影の違う面をマージしないこと**の代金である（`design-notes.md` M-10）
- **アンビエントオクルージョン** —— **達成**（`domain/ambient-occlusion.ts`。M-10）
- **十字板の植生** —— **達成**（`domain/plant-mesh.ts`。M-11）
- **流体の水面高と流れ方向** —— **達成**（`domain/fluid-mesh.ts`。M-12）。
  **§3 の保留行はこれで 0 になった。**
  流体面はマージしない（できない）ので上の削減率には現れず、
  `layered-water-glass` の数字も動いていない —— あの fixture は流体を宣言していないため

mc-meshing は**プレビューを持たない**。安定ライブラリ層は操作できる成果物を持たない。
メッシュを目視確認するのは mc-render の内蔵ビューア（plan.md §3.9）である。
