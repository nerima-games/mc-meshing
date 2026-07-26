# mc-meshing ドキュメント

このリポジトリを実装するために必要な情報を、`/Users/take/Documents/plan.md` を
読み返さずに済むよう、また参照実装の事実を再調査せずに済むようにまとめたもの。

参照実装（`takeokunn/ts-minecraft`）の記述には**すべて file:line の裏付け**を付けてある。
plan.md の数値のうち再検証で食い違ったものは `porting.md` に訂正として記録した。

## 読む順番

| # | ドキュメント | 内容 | こんなときに読む |
| --- | --- | --- | --- |
| 1 | [`architecture.md`](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリの依存グラフ（Mermaid）、このリポジトリの位置、名詞/動詞ルール、kit が devDependency 専用である理由、stage 順序表の所有者、依存ホワイトリスト CI | 最初に。全体像を掴む |
| 2 | [`responsibility.md`](./responsibility.md) | plan.md §3.3 の責務（原文）、その言い換え、**明示的にスコープ外のもの**、親と子 | 「これはここに書くべきか」で迷ったとき |
| 3 | [`public-api.md`](./public-api.md) | 公開すべき API と、**参照実装の実コードによる検証**。実シグネチャの引用付き。plan.md との差分は理由付き | 実装を書く前に |
| 4 | [`design-notes.md`](./design-notes.md) | plan.md の「設計注意」を証拠（file:line）付きで展開し、**名前付き回帰テスト**として書き下したもの | 実装中つねに。ソースのコメントからも参照している |
| 5 | [`porting.md`](./porting.md) | 移植元のパスと**実測 LOC**（`wc -l` で確認）、移植しないものとその理由、移植すべきテスト資産 | 参照実装のどこを見ればいいか探すとき |
| 6 | [`testing.md`](./testing.md) | 検証コマンド、テスト方針、カバレッジ閾値の扱い、**完成条件** | テストを書くとき／完成判定のとき |
| 7 | [`versioning.md`](./versioning.md) | 0.x → 1.0.0 の方針、GitHub Packages への publish、**何が破壊的変更か** | バージョンを上げるとき |

## 特に重要な項目への近道

- **boolean の `transparent` フラグでは足りない理由（2 つの透過集合）** → `design-notes.md` M-3、`public-api.md` §2
- **透過集合がネイティブ `Set` でなければならない理由（~40万call/chunk）** → `design-notes.md` M-1
- **`getBlock` が `Option` を返さない理由** → `design-notes.md` M-2
- **正準面順序 +X -X +Y -Y +Z -Z** → `public-api.md` §3
- **グリーディマージが未実装であること** → `public-api.md` §5、`testing.md` §4

## 上位資料

- `/Users/take/Documents/plan.md` —— リポジトリ構成仕様書（16 リポジトリ、確定済み）
- `/Users/take/ghq/github.com/nerima-games/mc-kernel/` —— 共有語彙。全リポジトリの雛形
- `/Users/take/ghq/github.com/takeokunn/ts-minecraft` —— 参照実装（凍結。仕様書兼テストオラクル）

## 本ドキュメントの方針

- **日本語で書く。** ただし識別子・パス・フラグ・コマンドは英語のまま。
- **主張には証拠を付ける。** 参照実装の記述には file:line を、LOC には `wc -l` の実測値を。
- **裏が取れなかったものは、取れなかったと書く。** 推測を事実の顔で書かない。
