# @nerima-games/mc-meshing

## 責務

チャンクデータ → ジオメトリバッファの純粋変換。三値の不透明度モデル、正準な面順序、
グリーディメッシング。

## 依存

`effect` のみ。`@nerima-games/*` のどのリポジトリにも依存しない。

将来的には `mc-kernel` に依存する（`Chunk` 型・能力フラグ）。
現時点で宣言していないのは、まだ何も publish されていないためである
（bottom-up に publish してから pin する方式）。
意図されたグラフは [`DEPENDENCY_POLICY.md`](https://github.com/nerima-games/.github/blob/main/DEPENDENCY_POLICY.md)
（org 標準）と [`docs/architecture.md`](./docs/architecture.md) に記録してある。実効機構は
`oxlint.json` の `no-restricted-imports`（Tier1: `@nerima-games/*` への依存を一切禁止）である。

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
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測(4 指標 99% 閾値。TEST_STANDARD.md §3) |
| `pnpm bench` | `scripts/bench-harness.ts` による自作ベンチマーク(`pnpm verify` / CI には含まれない。PERFORMANCE_STANDARD.md) |
| `pnpm verify` | `typecheck && lint && test`。CI と同じ内容 |

## 使い方

```typescript
import { meshChunk, emptyChunk, type MeshConfig } from '@nerima-games/mc-meshing'

const config: MeshConfig = {
  waterBlockIds: new Set([WATER_ID]),                    // 専用シェーダで描く
  transparentSolidBlockIds: new Set([GLASS_ID, LEAVES_ID]),  // アトラス + アルファブレンド
}

const { opaque, water, transparentSolid } = meshChunk(chunk, { xNeg: leftNeighbour }, config)
```

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

**このリポジトリはまだ第一版（叩き台）である。**

- **グリーディマージは実装済み。これがこのリポジトリの本体である。**
  同一スライス・同一方向・同一 `blockId` の面を最大矩形にまとめる（`domain/mesh.ts`）。
  quad 削減は flat で **-99.8%**（4,608 → 10）、rolling で **-86.2%**（5,558 → 768）、
  checkerboard で **0.0%** —— 最後のは欠陥ではなく、`(lx+y+lz)%2` には
  まとめられる面の対が 1 つも無いという**定義**である。被覆面積は 4 shape すべてで素朴実装と一致する。
  素朴な面抽出は `meshChunkNaive` として残してあり、**オラクル**である
  （`meshChunk` の各 quad を単位面へ展開して多重集合で突き合わせる性質テストがある）。
  `Quad.width` / `height` はもう常に 1 ではない。
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
- **`ChunkView` はローカルな構造型。** 本来 `Chunk` を所有するのは mc-kernel だが、
  まだ publish されていないので必要最小限の形だけ宣言してある。
  ストレージレイアウト（`blockIndex`）は参照実装と**同一**にしてあり、
  参照実装の chunk fixture をそのままゴールデン入力に使えるようにしてある。
- **未実装のもの**: アンビエントオクルージョン、流体の高さ / 流れ、植生メッシュ（十字板）、
  subregion 差分メッシュ、アキュムレータプール。（`yLimit` による打ち切りは
  `solidCeiling` として実装済み。）
  それぞれの参照実装での場所と LOC は [`docs/public-api.md`](./docs/public-api.md) §6。
- **返り値は所有されたデータ。** 参照実装はゼロコピーの subarray view を返し、
  「次の呼び出しまでしか有効でない」という実在の危険を持ち込んでいる
  （参照実装自身がコメントで警告している）。プール版はベンチマークを用意してから
  明示的な opt-in として追加する。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  `version` は mc-render が実際に消費して契約を確認するまで `0.x` に留める。
- **カバレッジ閾値は 4 指標 99% で有効化済み(TEST_STANDARD.md §3)。** 現状の実測は
  statements 100% / functions 100% / lines 100% / **branches 95.89%** であり、
  `branches` が未達のため CI のカバレッジステップは赤い。これは組織としての既知・受容済みの結果であり、
  閾値の緩和では対処しない(未到達分岐を埋めるテスト追加、または到達不能な分岐そのものの削除で対処する)。

## License

MIT
