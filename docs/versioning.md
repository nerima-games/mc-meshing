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
4. CI に publish job を追加（`.github/workflows/ci.yaml` は現在 typecheck / lint / check:deps / api:check / test / coverage のみ）
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

> **`0.x` の間の読み替え（全 16 リポジトリ共通の方針）**
>
> 本リポジトリは `0.1.0` であり、下流が契約を実際に消費して確認するまで `0.x` から出ない。
> **semver では `0.x` の破壊的変更は major bump ではなく minor bump である**（`0.1.0` → `0.2.0`）。
> したがって以下の MAJOR / MINOR / PATCH は **`1.0.0` 到達後の分類**であり、
> `0.x` の間は次のように読み替える。
>
> | 分類 | `1.0.0` 到達後 | `0.x` の間（現在） |
> | --- | --- | --- |
> | MAJOR | major bump | **minor bump**（`0.1.0` → `0.2.0`） |
> | MINOR | minor bump | patch bump |
> | PATCH | patch bump | patch bump |
>
> 分類そのものは `0.x` でも意味を持つ。MAJOR に分類される変更は、
> bump の大きさに関わらず**下流に必ず影響するもの**であり、告知と協調リリースの対象である。
> `0.x` の間に major bump を切ることはない。

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

**実装済みである。** リポジトリ直下の `api-lock.md`（公開宣言 31 件）が公開面の正本で、
生成器は `scripts/api-lock.ts`。16 リポジトリに byte-identical で vendor する方式は
`scripts/check-dependency-whitelist.ts` と同じで、編集してよいのは `REPOSITORY_POLICY` だけである。

| 項目 | 内容 |
| --- | --- |
| 検査 | `pnpm api:check` — `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了 |
| 更新 | `pnpm api:update` |
| 配線 | `pnpm verify` の `check:deps` と `test` の間、および CI の独立ステップ |
| 追加依存 | **なし**（`typescript` は既に devDependency） |

plan.md §9 の未決事項「API ロックファイルのツール選定（api-extractor 相当の Effect-TS 互換手段）」は
これで決着した。`@microsoft/api-extractor` は mc-kernel の実コードで試したうえで却下してある
（決め手は `Context.Tag` のサービスクラスが写らないこと）。理由と実測は
mc-kernel の `docs/versioning.md` §7 が正本なので、ここでは繰り返さない。

**mc-meshing で写るもの／写らないものを、上の §5 の MAJOR 一覧に突き合わせておく。**
`MeshLayers` の形（3 レイヤ）と `MeshConfig` の集合が native `Set`（`ReadonlySet<number>`）であることは
型として `api-lock.md` に記録されるので、崩せば diff になる。`Quad` の 8 フィールド、
`FaceDirection` の 6 リテラル、`FaceRole` の 3 リテラルも同様である。
一方 `FACES` と `MESH_LAYER_PRIORITY` は `ReadonlyArray<Face>` / `ReadonlyArray<MeshLayer>` としか写らない。
**並びは型に出ない以上ロックには映らない。** §5 が MAJOR としている「`FACES` の順序または法線の変更」
「`MESH_LAYER_PRIORITY` の変更」を守るのは、引き続きゴールデンハッシュのテストの仕事である。
ロックは形を、テストは値と挙動を見る。

`test/public-api.test.ts` は残っているし、消す理由もない。あれは barrel の export 名を
明示的に列挙してピン留めし、**名前の消失**を実行時に落とすテストである。
シグネチャの変更を捕まえるのは `api-lock.md` の側で、両者は補完関係にある。
mc-render がこのリポジトリを pin する以上、この二重の網が要る。

なお interface / 型リテラルのメンバ順はソース順のまま保たれるので、
`Quad` のフィールドを並べ替えると API 変更でなくても diff になる。承認は 1 行で済む。
