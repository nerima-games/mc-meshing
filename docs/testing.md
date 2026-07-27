# 検証と完成条件

- 上位仕様: plan.md §3.3（検証）、§6 Step 2（完了条件）

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト・ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint / format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm api:check` | `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了（[versioning.md](./versioning.md) §6） |
| `pnpm api:update` | `api-lock.md` を書き直す |
| `pnpm test` | vitest。`@effect/vitest` の `it.effect` が主 API |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。§3 参照） |
| `pnpm verify` | `typecheck` / `lint` / `check:deps` / `api:check` / `test` を直列実行。**CI と同じ内容** |
| `pnpm bench` | ベンチマーク（`scripts/bench-meshing.ts`）。**`verify` には入らない**（§7） |

セットアップ:

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0 が要る。
`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい。

> ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

## 2. テストの方針

### `it.effect` を使う

`@effect/vitest` の `it.effect` が主 API である。純粋な同期アサーションでも
`Effect.sync(() => { ... })` で包む。理由は一貫性であり、
Effect を要求するコードが後から入ったときにテストの書き方が変わらないためである。

**例外**（参照実装で確立済み、plan.md §3.13）: DOM イベントフローのテストで
`Effect.fork` + `Deferred.await` を `it.effect` の中に書くとデッドロックする。
そのときはプレーンな `it` + `Effect.runPromise` を使う。
mc-meshing は DOM を触らないので現時点では該当しない。

### プロパティテストを優先する

`effect` の `FastCheck` re-export（`import { FastCheck } from 'effect'`）を使う。
`.npmrc` が `fast-check` と `pure-rand` を hoist しているのは、これの型解決と
Vite からの解決のためである。

mc-meshing で最も価値が高いのは**被覆と面順序のプロパティテスト**である。

- 孤立した 1 ブロックはちょうど 6 面
- 隣接する 2 ブロックは 12 面ではなく **10 面**（共有面が両側から cull される）。
  11 面なら片側だけ cull されたということで、これは「片面だけ見えない壁」として現れる
- N×N の平板は `2*N*N + 4*N` 面
- 面は「非 air セル数 × 6」を超えない

**グリーディマージが着地したので、上の 4 つはすべて「面数」ではなく「被覆面積」の主張になった。**
1x1 quad しか無かった間、`totalQuadCount` と `totalQuadArea` は同じ数であり、
どちらのつもりで書いたのかを区別する必要が無かった。いまは違う ——
**マージが減らすのが数、変えてはならないのが面積**である。
そのため `domain/mesh.ts` は `totalQuadArea` を export し、上の主張はすべてそちらで書かれている。
値は 1 つも変わっていない（10 は 10 のまま、`2N²+4N` も同じ）。単位が正しくなっただけである。

### このリポジトリで最強のテスト —— マージ対オラクル

```
test/mesh.test.ts
  REGRESSION: merged output covers exactly the same block-faces as unmerged output
```

`meshChunk`（マージ後）の各 quad を、それが覆う単位ブロック面へ展開し、
`meshChunkNaive`（1 ブロック面 = 1 quad）の出力と**多重集合として**突き合わせる。
任意のチャンク（箱を塗って生成。散らばったセルではない —— 散らばりではマージがほとんど起きず、
「マージを一切しない実装」でも通ってしまう）と任意の隣接チャンク構成に対して成り立つ。

**集合ではなく多重集合であることが要点である。** 2 つの quad が 1 行ぶん重なるバグは、
同じ**集合**を作り、より大きい**多重集合**を作る。ソート済み配列の比較はこれを捕まえ、
`new Set(...)` の比較は捕まえない。

これがあるおかげで、**ゴールデン（出力順）を動かす判断が正当化できる**。
順序が変わっても被覆が同じであることを、fixture ではなく性質として示せるからである。

なお `meshChunkNaive` は**テストファイルの中ではなく `domain/mesh.ts` に置いて export してある**。
`test/` にコピーを置くと、オラクルの側が黙って drift する余地が生まれる。

### 少数の誠実なテスト > 多数の自明なテスト

各テストは「何が壊れたら落ちるか」が一意に分かる名前を持つこと。
`design-notes.md` の各項目には**回帰テスト名**が振ってあり、ソースのコメントからも
同じ名前で参照している。テストを消すときは design-notes 側も同時に更新すること。

## 3. カバレッジ閾値は**まだ**有効化していない

参照実装は branches / functions / lines / statements すべてに **99%** を強制している。
本リポジトリは計測とレポートは常に動かしているが、**閾値は設定していない**。

理由（`vitest.config.ts` のコメントにも記載）:
スケルトンに閾値を課しても意味がない。第一版のモジュール数個で自明に満たされてしまい、
実装の質については何も言わない数字になる。

**99% ゲートは完成条件（§4）に到達した時点で、`vitest.config.ts` と CI の両方で有効化する。**

```typescript
// vitest.config.ts に追加する行
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

## 4. 完成条件

plan.md §6 Step 2 の各リポジトリ完了条件は
「ユニット/シナリオテスト green + 内蔵プレビューが操作可能」である。

**mc-meshing はプレビューを持たない。** 安定ライブラリ層（plan.md §2.2）は
「純粋関数・狭い界面」であって、ユーザが操作できるものではない。
plan.md §2.3-4 が「プレビューは検証対象と同居する」と定め、
§3.7 が「worldgen の地形プレビューが最初の遊べる成果物」と明示しているとおり、
プレビューを持つのは基盤層以上である。

したがって mc-meshing の完成条件は:

- **ゴールデンテスト**（chunk fixture → バッファのハッシュ比較）—— plan.md §3.3 の要求。**未達**
- **性質テスト**（面数上限、隣接チャンク境界の整合）—— 同上。現在の被覆テストがこれに当たる。**達成**
- **グリーディメッシングの実装** —— **達成**（`domain/mesh.ts`）。
  旧記述「まだ無い。マージ実装は現在のテストをすべて green のまま通さなければならない」は
  **後半が誤りだったことが実装で判明した**ので、そのまま残さず訂正する。
  マージは 7 本のテストを落とした。うち 6 本は「面数」で書かれた被覆の主張（面積に書き換えた。値は不変）、
  1 本は面順序である。**面順序は保存できない** —— 理由は次項
- 参照実装の chunk fixture をゴールデン入力として取り込む
  （`blockIndex` のレイアウトを参照実装と同一にしてあるのはこのため）。**未達**

### 方向内の出力順は動いた。動かさずに済ませる方法は無い

`domain/mesh.ts` は以前「方向内では `lx` → `lz` → `y` 順であり、これはゴールデンハッシュにとって
load-bearing である」と宣言していた。**グリーディマージはこれを保てない。**
平面内の最大矩形は、その平面のセルをまとめて訪れなければ見つからないので、
**面の法線軸が最も外側のループにならざるを得ない**。+Y/-Y のそれは `y` であり、旧順序ではそれが最内だった。

現在の順序は方向ごとに別であり、`test/mesh.test.ts` が方向ごとに厳密な列として固定している:

| 方向 | 順序 |
| --- | --- |
| `xPos` / `xNeg` | `lx`（スライス）→ `lz` → `y` —— **素朴実装と同一** |
| `yPos` / `yNeg` | `y`（スライス）→ `lx` → `lz` |
| `zPos` / `zNeg` | `lz`（スライス）→ `lx` → `y` |

**正準な方向順（`FACES`）は不変である。** mc-render のゴールデンハッシュが本当に固定していたのは
そちらであり、方向内の列は 6 分の 4 で動く。
**このリポジトリにゴールデンハッシュのファイルは存在しない**（`grep golden` はコメントと
mc-render への言及しか返さない）ので、ここで再生成したものは無い。
動くのは mc-render 側でバッファ全体のハッシュを取っている場合であり、
それは**メッシュ形式の変更**であってリファクタではない。`versioning.md` の扱いに従うこと。

順序テストの fixture も差し替えた。旧 `SCATTERED` は 5 ブロックが各軸で相異なる値を持っており、
**先頭キーだけで列が決まってしまう** —— つまり `y → lz → lx` を `y → lx → lz` と区別できなかった。
新しい fixture は 6 ブロックで、3 つが `y=10` を共有し、2 つが `(lx, lz)` を共有する。
9 つのキー位置すべてがどこかで tie を破る。

到達時に行うこと:

1. `vitest.config.ts` と `.github/workflows/ci.yaml` で 99% 閾値を有効化
2. ビルド / publish パイプラインを追加（`versioning.md` §3）
3. `0.x` → `1.0.0`（mc-render が実際に消費して契約を確認したら）

## 5. CI

`.github/workflows/ci.yaml` は `pnpm verify` と同じ内容を job のステップに展開したものである
（失敗箇所が step 名で分かるようにするため）:

1. Checkout
2. Setup pnpm（`pnpm/action-setup@v4`）
3. Setup Node.js 22（pnpm キャッシュ有効）
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck`
6. `pnpm lint`
7. `pnpm check:deps` —— **ハードゲート**。参照実装の `check-package-dag.ts` と違い、
   違反があれば必ず非ゼロ終了する
8. `pnpm api:check`（step 名は `API lock`）—— **ハードゲート**。`api-lock.md` が
   現在の公開 API と食い違えば非ゼロ終了する（[versioning.md](./versioning.md) §6）
9. `pnpm test`
10. `pnpm test:coverage`（閾値なし。§3）
11. カバレッジレポートを artifact に upload（7 日保持）

## 6. 現時点のテスト一覧

| ファイル | 内容 |
| --- | --- |
| `test/mesh.test.ts` | 被覆面積（孤立 1 ブロック = 6、隣接 2 ブロック = 10、N×N 平板 = `2N²+4N`、上限 6/セル）とマージ後の面数（それぞれ 6 / 6 / 6）、**マージ対オラクル**（被覆の多重集合一致・重複被覆なし・ブロック ID をまたがない・レイヤをまたがない）、面順序（正準な方向順、方向ごとの列、決定論）、レイヤ振り分け（water / transparentSolid / 優先度・同レイヤ cull）、チャンク境界（隣接なし = 開放、隣接あり = 遮蔽）、**Y 走査上限**（最上段 y=255 が消えないこと）、`getBlock` の範囲外 = AIR |
| `test/public-api.test.ts` | barrel の export、透過集合が native `Set`、レイヤ優先度、正準面順序と法線と role、`oppositeDirection` の対合性、lookup table の全域性、`occludes` の意味論 |
| `test/lod.test.ts` | LOD 段の語彙（`LOD_LEVELS` / `LodLevelSchema`）、`packQuadKey` の単射性（3^9 全数）と 2^53 上界、LOD 0 の同一性、純粋性（入力を書き換えない・水とガラスは素通し）、snap の軸（水平のみ・Y は不変）、**素朴メッシュに対する**削減の厳密な数（上下面 ÷step²、側面 ÷step）、**マージ済みメッシュに対しては何も削減しないこと**（M-8 / M-9）、穴が開かないこと（包含）、出力列が入力列の部分列であること（並べ替えでないこと）、接線軸規約（`faceOf` / `tangentAxes`） |
| `test/check-dependency-whitelist.test.ts` | 16 リポジトリ roster の完全性、非循環、体験モジュール間エッジ 0、kit の devDependency 専用性、推移閉包の拒否、`Date.now()` 禁止、import 抽出 |

## 7. ベンチマーク（`pnpm bench`）

### なぜ必要か

plan.md §5.2 は 5 つのパフォーマンス例外を「実測で確定した。Effect 慣用スタイルに
『修正』するな」と定めている。うち 2 つ（M-1 透過集合はネイティブ `Set`、
M-2 `getBlock` は境界チェックをインライン化し `Option` を割り当てない）はこのリポジトリにある。
しかし**回帰を検出する手段が無かった**。M-1 のテストは `instanceof Set` という**型**を見るだけで、
入れ替えたときにいくら遅くなるかは何も言わない。レビューで実際に効くのは後者の数字である。

さらに、このリポジトリの本体であるグリーディメッシングの存在理由は速さそのものである。
比較対象が無いまま実装を入れると、「速くなった」ことを誰も示せないし、
後から「まだ速いか」も分からなくなる。**だから計測が先で、実装が後**だった。

### グリーディマージが着地したあとの数字

**quad 削減（正確な数え上げ。timing ではない）:**

| fixture | 素朴 | マージ後 | 削減 | 被覆面積の一致 |
| --- | ---: | ---: | ---: | :-: |
| flat | 4608 | **10** | **-99.8%** | ✅ |
| rolling | 5558 | **768** | **-86.2%** | ✅ |
| checkerboard-worst | 12288 | **12288** | **0.0%** | ✅ |
| layered-water-glass | 5376 | **17** | **-99.7%** | ✅ |

checkerboard で 0% なのは欠陥ではなく**定義**である。`(lx+y+lz)%2` は同じ面が 2 つ隣り合う場所を
1 つも作らないので、マージできる対が存在しない。これがグリーディメッシングの最悪ケースであり、
fixture がその名前である理由でもある。
「被覆面積の一致」列は結果ではなく**検算**で、`pnpm bench` が毎回両方の実装で面積を計算して比べる。
ここが `NO` になったらマージが面を落としているので、同じ行の削減率には意味が無い。

**wall-clock については、素直な比較が実態を過大評価する。**
`meshChunk` は 4 shape すべてで `meshChunkNaive` の 0.4-0.5 倍の時間で終わるが、
**その利得はマージのものではない。** マージと同時に入れた `solidCeiling`（参照実装の `yLimit`。
地形より上の空気の列を走査しない）が効いている。
`solidCeiling` を強制的に無効化して測り直すと:

| fixture | 素朴（256 走査） | マージ（256 走査） | マージのみの比 |
| --- | ---: | ---: | ---: |
| flat | 1.378 ms | 1.604 ms | **1.16x 遅い** |
| rolling | 1.403 ms | 1.678 ms | **1.20x 遅い** |
| checkerboard-worst | 1.148 ms | 1.686 ms | **1.47x 遅い** |
| layered-water-glass | 1.420 ms | 1.861 ms | **1.31x 遅い** |

**マージ単体は 4 shape すべてで遅く、checkerboard で最も遅い。**
これは予想どおりで、グリーディメッシングは**時間を払って三角形を買う**取引だからである。
マスクを組んで掃くぶんの仕事が増え、checkerboard ではその見返りがゼロになる。
時計が速くなったのは `solidCeiling` のおかげであり、2 つを混ぜて「マージで速くなった」と
言ってはならない。`design-notes.md` M-9 に測り方を含めて記録してある。

### 何を測っているか

`scripts/bench-meshing.ts`。fixture（flat / rolling / checkerboard、および x81 チャンクという枠組み）は
参照実装の `scripts/bench-meshing.ts` からの移植である。手法も参照実装のもの——
**ウォームアップののち 7 回計測しその中央値**——であり、発明していない。
`layered-water-glass` だけは追加である（参照実装のベンチは不透明ブロックしか流しておらず、
本リポジトリ固有の 3 値レイヤ振り分けが計測から漏れるため）。

fixture は完全に決定論的である。PRNG も時計も入力も無い。
fixture 自体は `scripts/bench-fixtures.ts` に切り出してある（`bench-meshing.ts` は
末尾で `process.exit` するので、テストから import して同じ地形の quad 数を数えられない）。

**LOD 簡約について 2 種類の数字を出す。**

- **費用**: `simplifyMesh/lod{1,2}/{fixture}` の 8 本を workload 比として baseline に載せた。
  簡約はメッシングと同じ桁の費用で、checkerboard では **2.9 倍**高い（`design-notes.md` M-8）。
- **削減量**: quad の**数え上げ**であって timing ではない。決定論的な関数と決定論的な fixture の
  積なので時計が 1 つも入らず、機械非依存で厳密である。**baseline とは突き合わせない** ——
  tolerance の要る量ではないからである。timing の隣に印字するのは、
  「その費用を払う値打ちがあるか」を答えるのがこの数字だからで、
  離して置けば両者は必ずずれる。表と読み方は `design-notes.md` M-8。

### 絶対値ではなく**比**を検査する

「3.4 ms/chunk」という絶対値を baseline にしても機能しない。それは記録した機械を写しているだけで、
遅いランナーでは常に落ち、速いランナーでは常に通る。捕まえたいのは
**「3 倍遅くなった」**であって「4.2ms かかった」ではない。そこで 2 種類の比を使う:

| 種類 | 定義 | 機械依存性 | 既定 tolerance |
| --- | --- | --- | --- |
| **guard** | 同一プロセス・同一データ上での 2 実装の A/B 比 | **無い**（機械が約分される） | 1.30x。ただし shipped-vs-frozen は 1.15x |
| **workload** | 実測値 ÷ 同じ run 内で測った yardstick | 近似的にしか無い | 2.00x |

`scripts/bench-baseline.json` がコミットされた baseline である。
記録は **5 回の通し実行の中央値**であり、1 回の実行ではない。

### guard の 2 つの役割

- **shipped-vs-frozen（ゲート本体）** —— 出荷している `getBlock` を、
  **その現在の形をそのまま凍結したコピー**と比較する。比は今 0.94 付近にあり、
  `getBlock` が遅くなれば——理由が何であれ——落ちる。
  書き換え版と比較するだけでは不十分である: 比はどちらの辺が変わっても同じ向きに動くので、
  出荷側が遅くなったのか比較対象が速くなったのかを区別できない。
- **price list（値札）** —— 「HashSet にしたら何倍か」を数字で示す。
  レビューで「native `Set` でいい理由」を問われたときに出す答えがこれである。

### 実測値（Apple M4 Max / Node 22.23.1、5 回通しの中央値）

| guard | 比 |
| --- | --- |
| `set-membership/hashset-vs-lookup-table` | **12.8x**（Effect `HashSet.has` 対 `buildLayerLookup` の `Uint8Array`） |
| `set-membership/native-set-vs-lookup-table` | **6.6x**（native `Set.has` 対 `Uint8Array`） |
| `set-membership/hashset-vs-native-set` | **1.9x**（Effect `HashSet.has` 対 native `Set.has`） |
| `neighbour-read/option-vs-plain-number` | **2.1x**（`Option` 返し 対 素の `number` 返し） |
| `neighbour-read/shipped-vs-frozen-inline-reference` | 0.91（ゲート。1.0 付近であるべき値） |

### ゲートの ばらつき についての訂正 —— shipped-vs-frozen は**静かではない**

`bench-harness.ts` のヘッダは shipped-vs-frozen ゲートの ばらつき を 5-6% とし、
それを根拠に他より**厳しい** 1.15 の tolerance を与えている。
**再録時の実測は 25%** である（5 回で 0.879 / 0.893 / 0.983 / 1.026 / 1.124、中央値 0.983）。
1.15 の下では失敗閾値が 0.855 なので、最低の run は閾値のわずか 3% 上にある。
**赤くなったとき最初に疑うべきはこのゲートである。** 他の guard は 3-8% で、
ヘッダの主張どおりに静かである。tolerance を動かすかどうかは人間の判断であり、
ここでは baseline を手順どおり中央値で記録し、事実だけを残す。

### Node のメジャー版をまたいで比べてはならない

同じベンチマークを Node 24.13.0 で走らせると workload 比が 22-32% 上、
HashSet 系の guard が 16-18% 上に出る。baseline の記録環境は
**flake の devShell の Node 22.23.1**（CI と同じ）であり、記録も検査も
`nix develop --command pnpm bench` で行うこと。

いずれも 1 チャンク分の 393,216 回（6 面 × 16×16×256）のルックアップ上での測定である。

**M-1 の記述の訂正**: `opacity.ts` は Effect の `HashSet` を native `Set` より
「桁違いに遅い」と書いているが、**実測は 1.9 倍**であって桁違いではない。
結論は変わらない——ただし理由が変わる。効いているのは `HashSet` 対 `Set` ではなく
**`Set` 対 `Uint8Array` ルックアップテーブル**（6.6x）のほうであり、
両方を合わせた 12.8x が「内側ループを配列インデックスにする」ことの本当の値打ちである。
design-notes M-1 が「native Set でも内側ループには遅すぎる」と書いているのは正しく、
数字はそちらを支持している。

### ゲートが実際に落ちることの確認

`domain/chunk-view.ts` の `getBlock` を「境界チェックをヘルパに切り出し `Option` を経由する」
という**もっともらしいリファクタ**に一時的に書き換えて実行したところ:

```
REGRESSED  neighbour-read/shipped-vs-frozen-inline-reference  observed 0.392  baseline 0.944  (0.41x)   # baseline は当時の値
REGRESSED  neighbour-read/option-vs-plain-number              observed 0.932  baseline 2.237  (0.42x)
REGRESSED  meshChunk/flat                                     observed 30.594 baseline 9.986  (3.06x)
REGRESSED  meshChunk/rolling                                  observed 31.734 baseline 10.135 (3.13x)
```

6 件の regression と exit 1。`meshChunk` は実際に **3.1 倍**遅くなっていた。

### ベンチが**できない**こと

wall-clock は粗い道具である。tolerance より安い書き換えはすり抜ける。
**綴りの不変条件は型システムと design-notes の名前付き回帰テストの仕事**であって、
このファイルはそれに値札を付けるだけである。どちらか一方を他方の理由で消してはならない。

### `verify` に入っていない理由と、CI について

これらのリポジトリは public で、CI は **`pull_request` ごとに**走る。
ベンチマークは 1 リポジトリあたり 4〜6 秒だが、それは共有ランナーの実時間であり、
かつ共有ランナーの実時間は**負荷で揺れる**——つまり workload 比は CI ではここで測ったより不安定になる。

**推奨**: いま CI ジョブを足すべきではない —— ただし**理由は 1 つ減った**。
旧記述は「グリーディメッシングが未実装で baseline がこれから大きく動くこと」と
「落ちたときに人間が読んで判断する必要があること」の 2 つを挙げていた。
前者はもう当てはまらない（着地し、baseline は取り直した）。後者は残る。

足すなら `push` on `main` か nightly（`pull_request` ではなく）で、
`--workload-tolerance` を緩めて **guard だけ**を見る形が妥当である。
workload だけを見る CI は特に勧めない —— 今回の取り直しで観測した ばらつき は
guard が 6-9%、workload が 34-66% であり（前回の記録はそれぞれ 3-8% / 6-10%）、
差は並行負荷であってコードではない。**負荷のかかった共有ランナーでは workload 比は
ほぼ情報を持たない。** それまでは、`domain/` の hot path に触る PR のレビューで
人間が走らせるものとして扱う。

### baseline の更新手順

```console
$ pnpm bench --update-baseline
```

`BENCH_MACHINE` 環境変数に機械の説明を入れると `recordedOn` に記録される。
**更新は必ず、何がどう動いたかをコミットメッセージに書いて行うこと。**
baseline を黙って上書きするのは、ベンチマークを削除するのと同じである。

## 直前のカバレッジ拡張について — コミットメッセージの数字が誤っている

`test: cover the code the suites were walking past` のコミットメッセージは
「added 107 tests」と書いているが、**正しくは 27 本**である
(mc-noise 8 + mc-meshing 13 + mc-physics 6)。本リポジトリの実測は **79 → 92**。

107 は 1 日古いレビューの baseline (53/53/68) から引いた差であり、
その時点から 3 リポジトリはすでに 79/79/96 まで育っていた。
16 リポジトリ合計も 2,771 → 2,798 で、差は 27 と一致する。

**この誤りをここに残すのは、それが本プロジェクトで最も多く記録されている欠陥だからである** ——
「結論は正しく、証拠が間違っている」。`CONTINENTALNESS_CONTRAST`、`SETTLE_TICK_LIMIT`、
mc-meshing の HashSet 主張、`setDayLength → setTimeOfDay` の作業例に続く 5 例目で、
しかも**テストカバレッジを説明する文章の中で**やっている。
default branch は `non_fast_forward` で保護されているため履歴は書き換えられない。
書き換えられないこと自体は正しい設計であり、だから訂正はここに置く。
