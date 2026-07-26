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

mc-meshing で最も価値が高いのは**面数と面順序のプロパティテスト**である。

- 孤立した 1 ブロックはちょうど 6 面
- 隣接する 2 ブロックは 12 面ではなく **10 面**（共有面が両側から cull される）。
  11 面なら片側だけ cull されたということで、これは「片面だけ見えない壁」として現れる
- N×N の平板は `2*N*N + 4*N` 面
- 面数は「非 air セル数 × 6」を超えない

これらは**グリーディマージが保存しなければならない不変条件**である。
マージは面数を減らすが被覆は変えない。マージ実装が入る前に書いておくことで、
実装が「立っているオラクル」に対して着地する。

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

- **ゴールデンテスト**（chunk fixture → バッファのハッシュ比較）—— plan.md §3.3 の要求
- **性質テスト**（面数上限、隣接チャンク境界の整合）—— 同上。現在の面数テストがこれに当たる
- **グリーディメッシングの実装** —— これがこのリポジトリの本体であり、まだ無い。
  現在あるのは素朴な面抽出（1 ブロック面 = 1 quad）で、正しいが速くない。
  マージ実装は現在のテストをすべて green のまま通さなければならない
- 参照実装の chunk fixture をゴールデン入力として取り込む
  （`blockIndex` のレイアウトを参照実装と同一にしてあるのはこのため）

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
| `test/mesh.test.ts` | 面数（孤立 1 ブロック = 6、隣接 2 ブロック = 10、N×N 平板 = `2N²+4N`、上限 6/セル）、面順序（正準順・決定論）、レイヤ振り分け（water / transparentSolid / 優先度・同レイヤ cull）、チャンク境界（隣接なし = 開放、隣接あり = 遮蔽）、`getBlock` の範囲外 = AIR |
| `test/public-api.test.ts` | barrel の export、透過集合が native `Set`、レイヤ優先度、正準面順序と法線と role、`oppositeDirection` の対合性、lookup table の全域性、`occludes` の意味論 |
| `test/check-dependency-whitelist.test.ts` | 16 リポジトリ roster の完全性、非循環、体験モジュール間エッジ 0、kit の devDependency 専用性、推移閉包の拒否、`Date.now()` 禁止、import 抽出 |

## 7. ベンチマーク（`pnpm bench`）

### なぜ必要か

plan.md §5.2 は 5 つのパフォーマンス例外を「実測で確定した。Effect 慣用スタイルに
『修正』するな」と定めている。うち 2 つ（M-1 透過集合はネイティブ `Set`、
M-2 `getBlock` は境界チェックをインライン化し `Option` を割り当てない）はこのリポジトリにある。
しかし**回帰を検出する手段が無かった**。M-1 のテストは `instanceof Set` という**型**を見るだけで、
入れ替えたときにいくら遅くなるかは何も言わない。レビューで実際に効くのは後者の数字である。

さらに、このリポジトリの本体であるグリーディメッシングは**まだ実装されていない**うえ、
その存在理由は速さそのものである。比較対象が無いまま実装を入れると、
「速くなった」ことを誰も示せないし、後から「まだ速いか」も分からなくなる。
**だから計測が先で、実装が後**である。現在の素朴な面抽出の数字がグリーディが超えるべき基準になる。

### 何を測っているか

`scripts/bench-meshing.ts`。fixture（flat / rolling / checkerboard、および x81 チャンクという枠組み）は
参照実装の `scripts/bench-meshing.ts` からの移植である。手法も参照実装のもの——
**ウォームアップののち 7 回計測しその中央値**——であり、発明していない。
`layered-water-glass` だけは追加である（参照実装のベンチは不透明ブロックしか流しておらず、
本リポジトリ固有の 3 値レイヤ振り分けが計測から漏れるため）。

fixture は完全に決定論的である。PRNG も時計も入力も無い。

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
| `set-membership/hashset-vs-lookup-table` | **12.2x**（Effect `HashSet.has` 対 `buildLayerLookup` の `Uint8Array`） |
| `set-membership/native-set-vs-lookup-table` | **6.5x**（native `Set.has` 対 `Uint8Array`） |
| `set-membership/hashset-vs-native-set` | **1.9x**（Effect `HashSet.has` 対 native `Set.has`） |
| `neighbour-read/option-vs-plain-number` | **2.2x**（`Option` 返し 対 素の `number` 返し） |
| `neighbour-read/shipped-vs-frozen-inline-reference` | 0.94（ゲート。1.0 付近であるべき値） |

いずれも 1 チャンク分の 393,216 回（6 面 × 16×16×256）のルックアップ上での測定である。

**M-1 の記述の訂正**: `opacity.ts` は Effect の `HashSet` を native `Set` より
「桁違いに遅い」と書いているが、**実測は 1.9 倍**であって桁違いではない。
結論は変わらない——ただし理由が変わる。効いているのは `HashSet` 対 `Set` ではなく
**`Set` 対 `Uint8Array` ルックアップテーブル**（6.5x）のほうであり、
両方を合わせた 12.2x が「内側ループを配列インデックスにする」ことの本当の値打ちである。
design-notes M-1 が「native Set でも内側ループには遅すぎる」と書いているのは正しく、
数字はそちらを支持している。

### ゲートが実際に落ちることの確認

`domain/chunk-view.ts` の `getBlock` を「境界チェックをヘルパに切り出し `Option` を経由する」
という**もっともらしいリファクタ**に一時的に書き換えて実行したところ:

```
REGRESSED  neighbour-read/shipped-vs-frozen-inline-reference  observed 0.392  baseline 0.944  (0.41x)
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

**推奨**: いま CI ジョブを足すべきではない。理由は、グリーディメッシングが未実装で
baseline がこれから大きく動くこと、そして落ちたときに人間が読んで判断する必要があることの 2 つである。
足すとしたら**グリーディ実装が着地した後**、`push` on `main` か nightly（`pull_request` ではなく）で、
`--workload-tolerance` を緩めて guard だけを見る形が妥当である。
それまでは、`domain/` の hot path に触る PR のレビューで人間が走らせるものとして扱う。

### baseline の更新手順

```console
$ pnpm bench --update-baseline
```

`BENCH_MACHINE` 環境変数に機械の説明を入れると `recordedOn` に記録される。
**更新は必ず、何がどう動いたかをコミットメッセージに書いて行うこと。**
baseline を黙って上書きするのは、ベンチマークを削除するのと同じである。
