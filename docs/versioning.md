# バージョニングと公開

- 上位仕様: plan.md §6 Step 0 / Step 3、§9

## 1. 現在のバージョン: `0.1.0`

**1.0.0 にするのは、上流の消費者が実際にこのリポジトリを消費して契約を確認したときである。**

| バージョン | 意味 |
| --- | --- |
| `0.x` | 界面が未確定。**破壊的変更を minor bump で行ってよい**（semver の 0.x 規定どおり） |
| `1.0.0` | mc-render がこのリポジトリを実際に import し、公開 API が要求を満たすことを確認した |

「テストが green だから 1.0.0」ではない。テストは自分で書いた仮説を検証するだけであり、
界面が**使えるか**は消費者にしか分からない。plan.md §8 のリスク表が
「新規構築初期は全界面が高 churn」を挙げ、その対策として
「npm 公開を遅らせ dev-meta workspace で開発」を指定しているのはこの理由による。

## 2. なぜ今は publish しないのか（plan.md §6 Step 0-2）

> **npm公開・バージョンbump運用は界面安定（4週間APIロック無変更）まで開始しない**

16 リポジトリが互いを pin したバージョンで参照し合っている状態で界面が動くと、
1 つの変更が bump の連鎖を引き起こす。初期は全界面が高 churn なので、これは常時起きる。

対策は **mc-dev-meta workspace**（plan.md §6 Step 0-2）:
16 リポジトリの clone を `repos/` 配下に並べて 1 つの pnpm workspace として束ねる薄いリポジトリ。
開発中は `workspace:*` 解決でモノレポ同等の DX が得られ、bump 連鎖が構造的に発生しない。

したがって現在の `package.json` は:

- `dependencies` に `effect` だけを宣言する。`@nerima-games/*` は 1 つも入っていない。
- `exports` は **TypeScript ソースを直接指す**（`./index.ts`）。ビルド成果物ではない。
- ビルド / publish パイプラインは存在しない。

## 3. ビルドと publish は完成条件到達時に追加する

`tsconfig.base.json` は `"noEmit": true` である（コメントで理由を明記している）。
`.gitignore` の `dist/` には `# Build outputs (none yet — the build pipeline is added at completion)` と書いてある。

完成条件（`testing.md` §4）に到達した時点で追加するもの:

1. `tsconfig.build.json` の `noEmit` を外し、`dist/` に `.js` + `.d.ts` + source map を出す
2. `package.json` の `exports` を `dist/` に向ける（`files` も同様）
3. `prepublishOnly` で `pnpm verify` を強制
4. CI に publish job を追加（`.github/workflows/ci.yaml` は現在 typecheck / lint / check:deps / test / coverage のみ）
5. changesets 運用に切り替え（plan.md §6 Step 3）

## 4. 公開先: GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

plan.md §9 の未決事項に「パッケージ公開先（GitHub Packages / private registry）」があるが、
Step 0 の実装として GitHub Packages を選んである。組織 `nerima-games` の下に 16 パッケージが並ぶ。

消費側は `.npmrc` に次を要する:

```
@nerima-games:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

（本リポジトリの `.npmrc` には**この設定は入っていない**。今は誰も `@nerima-games/*` を
解決しないためである。現在の `.npmrc` の中身は `fast-check` / `pure-rand` の hoist だけで、
これは `effect/FastCheck` の型解決のために必要な設定である。）

## 5. 何が破壊的変更なのか

### MAJOR（1.0.0 到達後）

- `FACES` の順序または法線の変更 —— ゴールデンハッシュがすべて無効になる
  （`domain/faces.ts` に「変更は意図的な speed bump である」と明記）
- `MESH_LAYER_PRIORITY` の変更（`transparentSolid > water > opaque`）
- `MeshLayers` の形（3 レイヤ）の変更
- `blockIndex` のストレージレイアウト変更 —— 参照実装の chunk fixture が
  ゴールデン入力として使えなくなる
- `occludes` の意味論の変更（どのレイヤが遮蔽するか）
- `MeshConfig` の集合を native `Set` 以外にすること（plan.md §5.2 違反）

### MINOR

- グリーディマージの実装（**面数は減るが被覆は変わらない**ので、
  レイヤ / 順序 / 被覆のテストは全部 green のままでなければならない）
- 新しい `MeshConfig` フィールドの追加（省略時の既定値が現在の挙動と一致すること）
- 隣接チャンク処理の拡張

### PATCH

- ドキュメント、コメント、テスト
- 観測可能な出力を変えない内部リファクタ

## 6. API ロックファイル

plan.md §6 Step 0-3 は「初回コミットに ... APIロックファイル（公開APIのレポートを diff レビュー）」を求める。

**現時点では実装されていない。** 代わりに `test/public-api.test.ts` が
barrel の export を明示的に列挙してピン留めしている。
これは API ロックの貧者版であり、シグネチャの変更は捕まえられない（名前の消失だけを捕まえる）。

plan.md §9 の未決事項に「API ロックファイルのツール選定（api-extractor 相当の Effect-TS 互換手段）」が
挙がっており、選定後にここへ入れる。最も重要なのは mc-sim（依存ハブ）だが、
mc-meshing も mc-render が pin する以上は必要である。
