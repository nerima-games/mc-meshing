# 検証と完成条件

- 上位仕様: plan.md §3.3（検証）、§6 Step 2（完了条件）

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト・ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint / format 設定（prettier も biome も .editorconfig も置かない） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest。`@effect/vitest` の `it.effect` が主 API |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。§3 参照） |
| `pnpm verify` | 上記 4 つを直列実行。**CI と同じ内容** |

セットアップ:

```console
$ direnv allow          # devenv 経由で nodejs_22 + pnpm が入る
$ pnpm install
```

devenv を使わない場合は Node.js 22 以上と pnpm 9.15.0 が要る。
`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい。

> `devenv.lock` はコミットされていない。生成には devenv の実行が必要なため、
> 初回に devenv を動かした人がコミットすること。

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
8. `pnpm test`
9. `pnpm test:coverage`（閾値なし。§3）
10. カバレッジレポートを artifact に upload（7 日保持）

## 6. 現時点のテスト一覧

| ファイル | 内容 |
| --- | --- |
| `test/mesh.test.ts` | 面数（孤立 1 ブロック = 6、隣接 2 ブロック = 10、N×N 平板 = `2N²+4N`、上限 6/セル）、面順序（正準順・決定論）、レイヤ振り分け（water / transparentSolid / 優先度・同レイヤ cull）、チャンク境界（隣接なし = 開放、隣接あり = 遮蔽）、`getBlock` の範囲外 = AIR |
| `test/public-api.test.ts` | barrel の export、透過集合が native `Set`、レイヤ優先度、正準面順序と法線と role、`oppositeDirection` の対合性、lookup table の全域性、`occludes` の意味論 |
| `test/check-dependency-whitelist.test.ts` | 16 リポジトリ roster の完全性、非循環、体験モジュール間エッジ 0、kit の devDependency 専用性、推移閉包の拒否、`Date.now()` 禁止、import 抽出 |
