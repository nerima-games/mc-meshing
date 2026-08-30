# @nerima-games/mc-meshing

## 責務

チャンクデータ → ジオメトリバッファの純粋変換。三値の不透明度モデル、正準な面順序、
グリーディメッシング。

## 依存

`effect` と `@nerima-games/mc-kernel` に依存する。`Chunk` 型と能力フラグは
mc-kernel が所有し、`ChunkView` は kernel の `coord` とチャンクごとの `height` を
保持する。kernel の opaque なブロックストレージは、呼び出し側が境界で
メッシング用の byte view にコピーして渡す。
意図されたグラフは [`DEPENDENCY_POLICY.md`](https://github.com/nerima-games/.github/blob/main/DEPENDENCY_POLICY.md)
（org 標準）と [`docs/architecture.md`](./docs/architecture.md) に記録してある。実効機構は
`.oxlintrc.json` の `no-restricted-imports`（Tier1: `mc-kernel` 以外の `@nerima-games/*` への依存を禁止）である。

**Three.js には依存しない。永久に。**
参照実装は `packages/world` の Three.js import をゼロに保っており（再検証済み）、
本リポジトリはその分離を 1 段下で維持する。理由は 2 つ:
メッシングは production では Web Worker の中で走る（DOM も WebGL コンテキストも無い）、
テストは Node で走る。同じコードが両方で動かなければならない。
`tsconfig.base.json` の `"lib": ["ES2024"]` / `"types": []` がこれを型レベルで強制している。

## このリポジトリの位置づけ

| 関係 | リポジトリ |
| --- | --- |
| 親（依存先） | `mc-kernel` のみ |
| 子（依存元） | `mc-render` のみ |

4 階層アーキテクチャの**安定ライブラリ層**（plan.md §2.2）。

## ドキュメント

**[`docs/`](./docs/README.md) に実装に必要な情報をすべてまとめてある。**

| ドキュメント | 内容 |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | 4 階層、依存グラフ、依存ホワイトリスト CI |
| [`docs/responsibility.md`](./docs/responsibility.md) | 責務と、明示的にスコープ外のもの |
| [`docs/public-api.md`](./docs/public-api.md) | 公開 API と参照実装での裏付け |
| [`docs/design-notes.md`](./docs/design-notes.md) | 設計注意と、対応する名前付き回帰テスト |
| [`docs/porting.md`](./docs/porting.md) | 移植元パスと実測 LOC |
| [`docs/testing.md`](./docs/testing.md) | 検証と完成条件 |
| [`docs/versioning.md`](./docs/versioning.md) | 0.x → 1.0.0 と publish |

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11 を用意する
（`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい）。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 39 ルールが `warn`、`error` は 3 つだけ。このフラグが無かった頃は実質その 3 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`test/effect-test.ts` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（statements / branches / functions / lines をすべて 100% でゲート） |
| `pnpm bench` | `scripts/bench-harness.ts` による自作ベンチマーク（`pnpm verify` / CI には含まれない。PERFORMANCE_STANDARD.md） |
| `pnpm verify` | `typecheck && lint && test:coverage && build && verify:package`。CI と同じリリース検証 |

## 使い方

```typescript
import { meshChunk, emptyChunk, type MeshConfig } from '@nerima-games/mc-meshing'

const config: MeshConfig = {
  waterBlockIds: new Set([WATER_ID]),                    // 専用シェーダで描く
  transparentSolidBlockIds: new Set([GLASS_ID, LEAVES_ID]),  // アトラス + アルファブレンド
  fluidMaxLevels: new Map([[WATER_ID, 7], [LAVA_ID, 3]]),
}

const { opaque, water, transparentSolid, fluids } = meshChunk(chunk, { xNeg: leftNeighbour }, config)

for (const quad of fluids) {
  if (quad.direction !== 'yPos' || quad.flow === undefined) continue
  const [flowX, flowZ] = quad.flow.direction
  animateFluidTexture(quad, flowX, flowZ, quad.flow.falling)
}
```

流体上面の `flow.direction` は正規化された chunk-local X/Z ベクトルで、静水は `[0, 0]`。
`flow.falling` は `ChunkView.fluid.falling` の非ゼロ値を渡す。`falling` 配列と
`FluidQuad.flow` は別の条件で optional である。`ChunkView.fluid` がある場合は
`falling` 配列も必須だが、側面 quad には renderer 向けの `flow` が付かないため、
`FluidQuad.flow` は呼び出し側で確認する。
方向は同種流体の水面高の勾配から決定論的に計算し、空いた隣接セルの 1 段下に同種流体がある場合は
段差を越える流れとして扱う。未ロード隣接チャンクは流れを捏造せず静止側として扱う。

**透過集合は 2 つある。boolean 1 つでは足りない。**
水は専用シェーダ（波紋・屈折・可変高さ）、ガラスと葉は通常のアトラス材質 + アルファブレンド。
1 つに畳めばどちらかが必ず間違って描かれる。参照実装も 2 つ持っている
（`meshing-worker-config.ts:7-13`）。詳細は
[`docs/design-notes.md`](./docs/design-notes.md) M-3。

**集合はネイティブ `Set` でなければならない。Effect の `HashSet` は使用禁止。**
チャンクあたり約 40 万回の membership テストが走る。これは実測に基づく制約であり、
好みの問題ではない（plan.md §5.2）。詳細は
[`docs/design-notes.md`](./docs/design-notes.md) M-1。

## 現状

**このリポジトリは 0.x のメッシングライブラリであり、Minecraft Java の全ブロック表現を内包するものではない。**

- **opaque 限定のグリーディマージは実装済み。これがこのリポジトリの本体である。**
  同一スライス・同一方向・同一 `blockId`・同一 AO の opaque 面だけを最大矩形にまとめる
  （`domain/mesh.ts`）。transparentSolid、water、専用 fluid、plant は描画順やセル固有属性を
  安全に保つため統合せず、1x1 primitive のまま出力する。
  quad 削減は flat で **-99.8%**（4,608 → 10）、rolling で **-82.7%**（5,558 → 960）、
  checkerboard で **0.0%** —— 最後のは欠陥ではなく、`(lx+y+lz)%2` には
  まとめられる面の対が 1 つも無いという**定義**である。被覆面積は 4 shape すべてで素朴実装と一致する。
  素朴な面抽出は `meshChunkNaive` として残してあり、**オラクル**である
  （`meshChunk` の各 quad を単位面へ展開して多重集合で突き合わせる性質テストがある）。
  opaque の `Quad.width` / `height` はもう常に 1 ではない。
- **wall-clock ではマージは損である。** 4 shape すべてで素朴実装より 1.16-1.47 倍**遅い**
  （checkerboard が最悪）。時計が速くなって見えるのは同時に入れた `solidCeiling`
  （参照実装の `yLimit`）のおかげであり、マージのおかげではない。
  グリーディメッシングは**時間を払って三角形を買う**取引である。測り方は `design-notes.md` M-9。
- **方向内の出力順が変わった。** 最大矩形は平面ごとに探すほかないので、面の法線軸が最外ループになる。
  `xPos`/`xNeg` は素朴実装と同じ `lx`→`lz`→`y` のままだが、`yPos`/`yNeg` は `y`→`lx`→`lz`、
  `zPos`/`zNeg` は `lz`→`lx`→`y` である。**正準な方向順（`FACES`）は不変。**
  mc-render がバッファ全体のゴールデンハッシュを取っているなら、それは動く（`docs/testing.md` §4）。
- **LOD 簡約は移植済み**（`domain/lod.ts`）。`simplifyMesh(layers, level)` は座標を 1 つも取らない
  純粋関数で、opaque レイヤだけを粗い grid に丸めて重なった quad を落とす。段の**選択**
  （`lodForDistance` と 4 / 8 という距離定数）は mc-render の責務である（`responsibility.md` §3.4）。
  削減量は上下面で `step²`、側面で `step` —— Y を決して丸めない（シルエットを保つ）ことの代償であり、
  実測は `design-notes.md` M-8。**その数字は素朴メッシャ上の上限であり、
  マージ着地後に取り直したところ flat / layered で -0.0%、rolling で -2.9%（LOD 1）まで落ちた。**
  マージ済みメッシュでは snap しても一致する相手が残っていないためで、
  故障ではなく**吸収**である。`renderDistance = 4` で LOD 1 が買うのは quad の約 1.2% であり、
  その代金は約 11 px の水平方向のずれである —— 4 / 8 という定数どころか
  LOD 1 という段そのものが疑わしい。判断は mc-render のもの（`responsibility.md` §3.4 / §3.5）。
- **`ChunkView` はメッシング専用の可変高さビュー。** `Chunk` を所有するのは mc-kernel であり、
  `ChunkView` はその `coord` とチャンクごとの `height`、およびメッシング用の byte view を保持する。
  `blockCount` が高さを検証し、必要なストレージ長を算出する。異なる高さを暗黙に切り詰めたりゼロ埋めしたりしない。
  ストレージレイアウト（`blockIndex`）は参照実装と**同一**にしてあり、
  参照実装の chunk fixture をそのままゴールデン入力に使えるようにしてある。
- **実装済みの追加形状**: アンビエントオクルージョン、流体の高さ、植生メッシュ（十字板）、および
 mc-kernel が宣言する cactus / slab / pressurePlate / rail / lilyPad の専用ジオメトリ。
  専用形状は `MeshLayers.specialBlocks` で運び、レールは `ChunkView.railShapes` の復号済み sidecar から
  vanilla の 10 状態（平面、曲線、昇り）を選択する。曲線状態は vanilla の平面モデルを使い、昇り状態は
  vanilla の 45 度モデルを使う。sidecar の格納形式と state の復号は呼び出し側の責務である。
  AO と流体の角平均は optional な対角チャンクも参照し、未ロードなら従来どおり開境界として扱う。
  流体上面は renderer 向けの正規化された流れ方向と落下フラグも持つ。
  `ChunkView.light` に注入した block / sky light は cube の greedy merge key と全専用形状の四隅属性へ伝播し、
  `packMeshLayers` は両方の typed array を返す。ライトグリッドの生成・伝播は呼び出し側の責務である。
  `createMeshScratch()` で呼び出し元ごとの作業領域を作り、`meshChunk(..., scratch)` に渡すと、面マスクと
  ライト用の一時配列を呼び出し間で再利用できる。同じ scratch を並行メッシュ処理で共有してはならない。
  返り値のレイヤーと quad は毎回新しく所有される。出力アキュムレータのプールは、所有権とライフタイム契約を
  変えないことを優先し、この API では採用しない。
  参照実装での場所と LOC は [`docs/public-api.md`](./docs/public-api.md) §6。
- **返り値は所有されたデータ。** 参照実装はゼロコピーの subarray view を返し、
  「次の呼び出しまでしか有効でない」という実在の危険を持ち込んでいる
  （参照実装自身がコメントで警告している）。出力配列のプール版は所有権とライフタイム契約を変えるため、
  明示的な opt-in として追加していない。作業配列の scratch 再利用はこの所有権を変えない。
- **局所更新は `meshChunkRegion`。** chunk-local の半開 `dirtyRegion` を渡すと、face culling、AO、
  fluid corner が読む範囲を含む 1-cell halo（chunk 境界で clamp）を `ownedRegion` として返す。
  cube は安全な単位 face、plant / fluid もセル単位の独立所有バッファであり、呼び出し側は同じ
  `ownedRegion` の以前のバッファを丸ごと交換する。greedy な full-chunk mesh の quad を途中で splice
  してはならない。空領域は空の所有バッファを返し、従来の `meshChunk` API と出力は不変である。
- **ビルド成果物を公開検証する。** `exports` は `dist` の ESM と宣言ファイルを指し、
  `pnpm verify:package` は tarball に開発用ソースが混入していないことと公開 API の import を検査する。
  自動 publish はまだ有効化せず、mc-render が実際に消費して契約を確認するまで `version` は `0.x` に留める。
- **カバレッジは 4 指標 100% をリリースゲートにする。** `pnpm verify` が
  statements / branches / functions / lines をすべて計測し、未到達分岐は閾値の緩和ではなくテスト追加または
  到達不能な分岐の削除で対処する。

### Minecraft Java の機能境界

現行のメッシャが扱うのは、mc-kernel のブロックレジストリ／能力値または解析済みの
`ResourcePackAssets` を入力にしたジオメトリ生成である。キューブ面、透明固体、流体、十字板、
kernel 宣言形状、AO、LOD、リージョン更新に加え、resource pack の blockstate variant / multipart、
model の親継承・テクスチャ変数・ambient occlusion・回転・UV・UV lock・face metadata の解決と純粋な quad 化を提供する。
対応する JSON subset は `parseResourcePackAssets`（`unknown` 値）と
`parseResourcePackAssetsJson`（JSON 文字列）で `ResourcePackAssets` に検証できる。
モデルの `faces` と `cullface` は Java Edition の公式面名（`down` / `up` / `north` / `south` / `west` / `east`）を受け取り、
メッシュ出力の `direction` / `cullface` は本ライブラリの内部 `FaceDirection`（`xPos` など）で返す。

次の Java Edition の表現は、このライブラリの責務としてまだ実装していない。

- resource pack の zip / filesystem / PNG loader、テクスチャアトラス、material、tint / biome color
- ワールドのライトグリッド生成・伝播、WebGL / GPU device への upload、block entity の描画
- resource pack の generic な状態依存モデルを kernel の block-state sidecar と自動接続する統合
- ワールド生成、ブロック状態の伝播、流体シミュレーション、worker のライフサイクル

これらを追加する場合は、mc-kernel に状態・能力値の所有権があるかを確認し、mc-render 側の材質・バッファ責務と
重複するアダプターを増やさないことを前提に、別の受け入れ条件とゴールデン fixture を定義する。

## License

MIT
