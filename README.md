# @nerima-games/mc-meshing

## 責務

チャンクデータ → ジオメトリバッファの純粋変換。三値の不透明度モデル、正準な面順序、
グリーディメッシング。

## 依存

`effect` と `@nerima-games/mc-kernel` に依存する。`Chunk` 型、ブロック ID、能力フラグ、
ブロックレジストリは mc-kernel が所有し、メッシャーはその `Chunk` の storage layout と
`height` を直接利用する。変換アダプターや別のブロック定義テーブルは持たない。
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
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（statements / branches / functions / lines の 100% 閾値） |
| `pnpm bench` | `scripts/bench-harness.ts` による自作ベンチマーク(`pnpm verify` / CI には含まれない。PERFORMANCE_STANDARD.md) |
| `pnpm build` | 宣言ファイルと実行用 ESM バンドルを `dist/` に生成 |
| `pnpm verify` | `typecheck && lint && test && build`。CI と同じ内容 |

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
`FluidQuad.flow` は流体状態が存在する入力でのみ付く optional な描画記述子であり、側面 quad には `flow` が付かない。
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

**現行実装は mc-kernel のブロック定義を基準にした出荷可能なメッシング基盤である。**

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
- **`ChunkView` は mc-kernel の `Chunk` と同じ可変高さの layout を使う。** `height` が単一の真実であり、
  メッシャーは kernel の chunk を構造的にそのまま受け取る。ストレージレイアウト（`blockIndex`）も
  kernel と**同一**で、異なる高さを切り詰めたりゼロ埋めしたりする変換層はない。
- **実装済みの追加形状**: アンビエントオクルージョン、流体の高さ、十字板、サボテン、レール、
  lily pad。special render kind は mc-kernel のレジストリから構築される。
  AO と流体の角平均は optional な対角チャンクも参照し、未ロードなら従来どおり開境界として扱う。
  流体上面は renderer 向けの正規化された流れ方向と落下フラグも持つ。
- **固定形状は kernel の能力表から接続し、状態依存形状は推測しない。** 現行 mc-kernel の
  `collisionShape` を mc-meshing の公開 config に取り込み、状態を持たない slab は半ブロック、
  pressure plate は 1/16 inset・1/16 high の固定形状として出力する。stairs とレールの向き、
  slab の上下、pressure plate の押下状態は kernel が block state / 描画契約を公開していないため
  未実装である。`collisionShape` を全ての描画形状とみなす推測はしない。
  **未実装**なのはアキュムレータプールで、これは所有バッファの意味を変えるため別の性能検証が必要である。
  参照実装での場所と LOC は [`docs/public-api.md`](./docs/public-api.md) §6。
- **返り値は所有されたデータ。** 参照実装はゼロコピーの subarray view を返し、
  「次の呼び出しまでしか有効でない」という実在の危険を持ち込んでいる
  （参照実装自身がコメントで警告している）。プール版はベンチマークを用意してから
  明示的な opt-in として追加する。
- **局所更新は `meshChunkRegion`。** chunk-local の半開 `dirtyRegion` を渡すと、face culling、AO、
  fluid corner が読む範囲を含む 1-cell halo（chunk 境界で clamp）を `ownedRegion` として返す。
  cube は安全な単位 face、plant / fluid もセル単位の独立所有バッファであり、呼び出し側は同じ
  `ownedRegion` の以前のバッファを丸ごと交換する。greedy な full-chunk mesh の quad を途中で splice
  してはならない。空領域は空の所有バッファを返し、通常の `meshChunk` API と出力は不変である。
- **ビルドは宣言ファイルと実行用 ESM バンドルを `dist/` に生成する。** mc-kernel の実装は
  バンドルへ取り込み、`effect` は通常の実行時依存として外部化する。`exports` と `files` は
  `dist/` を指し、`prepublishOnly` は `pnpm verify` を実行する。
- **カバレッジ閾値は 4 指標すべて 100% で有効化済み**（`vitest.config.ts`）。

## License

MIT
