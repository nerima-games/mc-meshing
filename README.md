# @nerima-games/mc-meshing

## 責務

チャンクデータ → ジオメトリバッファの純粋変換。三値の不透明度モデル、正準な面順序、
グリーディメッシング。

## 依存

`effect` のみ。`@nerima-games/*` のどのリポジトリにも依存しない。

将来的には `mc-kernel` に依存する（`Chunk` 型・能力フラグ）。
現時点で宣言していないのは、まだ何も publish されていないためである
（bottom-up に publish してから pin する方式）。
意図されたグラフは `scripts/check-dependency-whitelist.ts` の roster と
[`docs/architecture.md`](./docs/architecture.md) に記録してある。

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
$ direnv allow          # devenv 経由で nodejs_22 + pnpm が入る
$ pnpm install
```

devenv を使わない場合は Node.js 22 以上と pnpm 9.15.0 を用意する
（`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい）。

> **注意**: `devenv.lock` はコミットされていない。生成には `devenv` の実行が必要なため、
> 初回に devenv を動かした人がコミットすること。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm verify` | `typecheck && lint && check:deps && test`。CI と同じ内容 |

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

- **グリーディマージが未実装。これがこのリポジトリの本体である。**
  現在あるのは素朴な面抽出（露出したブロック面 1 つにつき quad 1 つ、`Quad.width`/`height` は常に 1）。
  stub ではない —— **正しいが速くないだけ**である。
  マージが変えてはならない部分（レイヤ振り分け・正準面順序・遮蔽規則・境界挙動）は
  すべて確定してテストしてあり、現在の実装はマージ実装のオラクルとして機能する。
- **`ChunkView` はローカルな構造型。** 本来 `Chunk` を所有するのは mc-kernel だが、
  まだ publish されていないので必要最小限の形だけ宣言してある。
  ストレージレイアウト（`blockIndex`）は参照実装と**同一**にしてあり、
  参照実装の chunk fixture をそのままゴールデン入力に使えるようにしてある。
- **未実装のもの**: アンビエントオクルージョン、流体の高さ / 流れ、植生メッシュ（十字板）、
  LOD 簡約、subregion 差分メッシュ、アキュムレータプール、`yLimit` による打ち切り。
  それぞれの参照実装での場所と LOC は [`docs/public-api.md`](./docs/public-api.md) §6。
- **返り値は所有されたデータ。** 参照実装はゼロコピーの subarray view を返し、
  「次の呼び出しまでしか有効でない」という実在の危険を持ち込んでいる
  （参照実装自身がコメントで警告している）。プール版はベンチマークを用意してから
  明示的な opt-in として追加する。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  `version` は mc-render が実際に消費して契約を確認するまで `0.x` に留める。
- **カバレッジ閾値は未設定。** 参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
  計測とレポートは常に動かしており、99% ゲートは完成条件到達時に有効化する。

## License

MIT
