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

したがって現在の `package.json` は:

- `dependencies` に `effect` と `@nerima-games/mc-kernel` を宣言する。ブロック定義と `Chunk` は
  mc-kernel の公開 API を直接利用する。
- `exports` は型を `dist/index.d.ts`、実行時エントリを `dist/index.js` に向ける。
- `prepublishOnly` は型検査・lint・テスト・ビルドを含む `pnpm verify` を実行する。

## 3. ビルドと公開の現在の実装

`tsconfig.base.json` は通常の型検査では `"noEmit": true` のままだが、出荷用の
`tsconfig.build.json` は宣言ファイルだけを `dist/` に出力する。
`prebuild` は前回の生成物を消去し、同じコマンドで古いファイルが残らないようにする。

`pnpm build` は次を順に実行する:

1. `tsc` で公開型の `.d.ts` と source map を生成する。
2. `esbuild` で platform-neutral な ESM バンドルを生成する。mc-kernel の実装はバンドルへ
   取り込み、`effect` は実行時依存として外部化する。
3. `package.json` の `exports` と `files` は `dist/` の型・実行ファイルだけを公開対象にする。
4. CI は `pnpm verify` とカバレッジを実行する。公開操作は自動化せず、GitHub Packages への
   リリースは maintainer の明示的な操作と changeset による変更記録で行う。
5. changesets 運用は導入済み（本書 §7、RELEASE_STANDARD.md §1）。0.x → 1.0.0 の昇格判断
   （§2, §5 参照）も同じ changeset ワークフローに乗せる

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

本リポジトリの `.npmrc` にはレジストリ割当があり、認証トークンは含めていない。
`fast-check` / `pure-rand` の hoist も `effect/FastCheck` の型解決のために維持している。

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
- `MeshLayers` の形（面リストと `crossPlants` / `fluids` / `specials` の集合）の変更
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

「公開 API」とは `src/index.ts` が re-export するものそのものであり（API_STANDARD.md §1）、
破壊的変更の検出は上の §5 の MAJOR/MINOR/PATCH 基準に基づく人間のレビューで行う。
新しくスナップショット/diff ツール（`@microsoft/api-extractor` を含む）を追加する提案は
org 標準に反する。`@microsoft/api-extractor` は mc-kernel の実コードで試したうえで
既に却下されている（決め手は `Context.Tag` のサービスクラスが写らないこと。詳細は
API_STANDARD.md §4 および mc-kernel の `docs/versioning.md`）。

`test/public-api.test.ts` は残っているし、消す理由もない。あれは barrel の export 名を
明示的に列挙してピン留めし、**名前の消失**を実行時に落とすテストである。シグネチャの変更
そのものを捕まえるのは `pnpm typecheck` と個々の domain テスト（ゴールデンハッシュ等）であり、
`test/public-api.test.ts` は「barrel が何を re-export しているか」という名前の面だけを見る。

なお `MeshLayers` の形（面リストと特殊形状配列）や `MeshConfig` の集合が native `Set`（`ReadonlySet<number>`）
であることのような、上の §5 で MAJOR に分類した型レベルの契約は、`pnpm typecheck` が
`tsconfig.build.json` を通して検証する。`FACES` の順序や `MESH_LAYER_PRIORITY` の値のような
「型には出ないが意味を持つ」契約は、引き続きゴールデンハッシュのテストの仕事である。
