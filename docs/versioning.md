# バージョニングと公開

- 上位仕様: plan.md §6 Step 0 / Step 3、§9

## 1. 現在のバージョン: `0.1.4`

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

> **npm公開・バージョンbump運用は、上位階層が実際にこのリポジトリを消費し動作確認するまで開始しない。**
> 「4週間 API 無変更で凍結」という日数計測ベースの自動ゲートは org 標準として廃止された
> (RELEASE_STANDARD.md §4)。1.0.0 への昇格は maintainer(take)による裁量判断のみで行い、
> 代替の自動ゲートは設けない。

16 リポジトリが互いを pin したバージョンで参照し合っている状態で界面が動くと、
1 つの変更が bump の連鎖を引き起こす。初期は全界面が高 churn なので、これは常時起きる。

対策は **mc-dev-meta workspace**（plan.md §6 Step 0-2）:
16 リポジトリの clone を `repos/` 配下に並べて 1 つの pnpm workspace として束ねる薄いリポジトリ。
開発中は `workspace:*` 解決でモノレポ同等の DX が得られ、bump 連鎖が構造的に発生しない。

現在の `package.json` は、ビルド済み成果物を検証可能にする段階まで進んでいる:

- `dependencies` に `effect` と `@nerima-games/mc-kernel@0.4.0` を宣言する。
- `exports` は **`dist/` の ESM と declaration** を指し、開発用の `src/` / `test/` は tarball に含めない。
- `pnpm build` が `dist/` を生成し、`pnpm package:verify` が tarball の内容と展開後の import を検証する。
- `prepublishOnly` は `pnpm verify && pnpm package:verify` を実行する。
  GitHub Packages への publish は `.github/workflows/release.yaml`（org 標準。detect → publish → tag）が担う。

## 3. ビルドと publish の現在地

開発時の型検査は `tsconfig.base.json` の `noEmit` を維持し、`tsconfig.release.json` だけが
`dist/` に JavaScript と declaration を出力する（`tsconfig.build.json` は出荷ソースの型検査専用で emit しない）。
`pnpm verify` は次の順にゲートを通す:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`

カバレッジ計測（`pnpm test:coverage`、4 指標 100%）、`pnpm build`、`pnpm package:verify`
（tarball を作成し、公開形と同じ展開済み成果物を import）、`pnpm audit` は
CI（`.github/workflows/ci.yaml`）の別ステップとして実行される（docs/testing.md §5）。

changesets 運用は導入済み（本書 §7、RELEASE_STANDARD.md §1）。0.x → 1.0.0 の昇格判断
（§2, §5 参照）は、上流 consumer がこの公開形を import して契約を確認した後に行う。

## 4. 公開先: GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "public"
}
```

plan.md §9 の未決事項に「パッケージ公開先（GitHub Packages / private registry）」があるが、
Step 0 の実装として GitHub Packages を選んである。組織 `nerima-games` の下に 16 パッケージが並ぶ。
`access` は `public`（GitHub Packages 側で packages が public 化済みのため。`restricted` のままだと
新規 publish が private に戻り、下流 CI が 403 になる）。

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
> 本リポジトリは `0.1.4` であり、下流が契約を実際に消費して確認するまで `0.x` から出ない。
> **semver では `0.x` の破壊的変更は major bump ではなく minor bump である**（`0.1.4` → `0.2.0`）。
> したがって以下の MAJOR / MINOR / PATCH は **`1.0.0` 到達後の分類**であり、
> `0.x` の間は次のように読み替える。
>
> | 分類 | `1.0.0` 到達後 | `0.x` の間（現在） |
> | --- | --- | --- |
> | MAJOR | major bump | **minor bump**（`0.1.4` → `0.2.0`） |
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
- `MeshLayers` の出力コレクションと形状別分類の変更
- `blockIndex` のストレージレイアウト変更 —— 参照実装の chunk fixture が
  ゴールデン入力として使えなくなる
- `occludes` の意味論の変更（どのレイヤが遮蔽するか）
- `MeshConfig` の集合を native `Set` 以外にすること（plan.md §5.2 違反）

### MINOR

- グリーディマージの実装（**面数は減るが被覆は変わらない**ので、
  レイヤ / 順序 / 被覆のテストは全部 green のままでなければならない）
- 新しい `MeshConfig` フィールドの追加（省略時の既定値が現在の挙動と一致すること）
- LOD 簡約の追加（`simplifyMesh` / `packQuadKey` / `LodLevel` / `LOD_LEVELS` / `LodLevelSchema`）と、
  `Quad` の接線軸規約の明文化（`faceOf` / `tangentAxes` / `QuadAxis`）。
  既存のどの宣言も変えていないので純粋な追加である。
- 隣接チャンク処理の拡張

### PATCH

- ドキュメント、コメント、テスト
- 観測可能な出力を変えない内部リファクタ

## 6. API 変更の検証は自動スナップショットツールではなく人間のレビュー

**本リポジトリに自動生成された公開 API のスナップショット・diff ツールは存在しない。**
かつて、生成ファイルとその生成スクリプト、および検査/更新用の2つの pnpm スクリプトからなる
自前の公開 API スナップショット機構があったが、org 標準の策定に伴い撤去された
（API_STANDARD.md §4「自動 APIロック／スナップショットツールは使わない」。同節に歴史的経緯の詳細がある）。

「公開 API」とはソース上では `src/index.ts` が re-export し、パッケージ上では `dist/index.js` と
`dist/index.d.ts` が提供するものそのものであり（API_STANDARD.md §1）、
破壊的変更の検出は上の §5 の MAJOR/MINOR/PATCH 基準に基づく人間のレビューで行う。
新しくスナップショット/diff ツール（`@microsoft/api-extractor` を含む）を追加する提案は
org 標準に反する。`@microsoft/api-extractor` は mc-kernel の実コードで試したうえで
既に却下されている（決め手は `Context.Tag` のサービスクラスが写らないこと。詳細は
API_STANDARD.md §4 および mc-kernel の `docs/versioning.md`）。

`test/public-api.test.ts` は残っているし、消す理由もない。あれは barrel の export 名を
明示的に列挙してピン留めし、**名前の消失**を実行時に落とすテストである。シグネチャの変更
そのものを捕まえるのは `pnpm typecheck` と個々の domain テスト（ゴールデンハッシュ等）であり、
`test/public-api.test.ts` は「barrel が何を re-export しているか」という名前の面だけを見る。

なお `MeshLayers` の出力コレクションや `MeshConfig` の集合が native `Set`（`ReadonlySet<number>`）
であることのような、上の §5 で MAJOR に分類した型レベルの契約は、`pnpm typecheck` が
`tsconfig.build.json` を通して検証する。`FACES` の順序や `MESH_LAYER_PRIORITY` の値のような
「型には出ないが意味を持つ」契約は、引き続きゴールデンハッシュのテストの仕事である。
