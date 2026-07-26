# 設計注意と回帰テスト

plan.md §3.3 の「設計注意」を、参照実装の証拠（file:line）付きで展開し、
**それぞれを名前付き回帰テストとして**書き下したもの。

各項目の見出しにある `code` 名がテスト名である。ソース側のコメントからも同じ名前で参照している。

---

## M-1 `meshing-transparency-sets-are-native`

### plan.md §3.3 の記述

> **設計注意**: ホットパスの `transparentBlockIds: Set<number>` はネイティブ `Set` を維持（**~40万call/chunk**。Effect の HashSet は構造的等価性比較が遅く使用禁止）

### 参照実装の証拠

宣言（`packages/rendering/infrastructure/meshing/greedy-meshing.ts:64, 67`）:

```typescript
  transparentBlockIds: ReadonlySet<number> = new Set(),
  transparentSolidBlockIds: ReadonlySet<number> = new Set(),
```

`subregion-greedy.ts:93` も同じ。
`packages/` 全体を `HashSet` で grep してもメッシングファイルには 1 件もヒットしない
（Effect の `HashSet` / `MutableHashSet` を使っているのは `packages/app/**` のテストキットと
`interaction-break-handler.execute.ts` だけ）。

**型は `ReadonlySet<number>`**（TypeScript 組み込みの型）であり `Set<number>` ではない、
という細かい点も plan.md と実装で食い違っている。実装のほうが正しい。

### 「~40万call/chunk」の出典（実測で追跡）

この数字は参照実装に**ちょうど 1 箇所**現れる。
`packages/rendering/infrastructure/meshing/greedy-meshing-passes.ts:105`（原文）:

```typescript
// The inner mask-building loop (hot path, ~400k calls/chunk) is NOT factored through
// this helper; it stays inlined inside each pass call-site in greedyMeshChunk.
```

**正確に言うと**、このコメントは ~40 万 call を `transparentBlockIds` の lookup ではなく
**内側の mask 構築ループ**に帰している。裏取り: 6 パス × 16×16×256 = 393,216 なので、
この数字は「6 パス分の全セル数」である。

つまり plan.md の「~40万call/chunk」は正しいが、対象がややずれている。
結論は変わらない —— 集合の membership テストはそのループの中で行われる。

### さらに: native Set でも内側ループには遅すぎる

参照実装は Set を**一度だけ** 256 エントリの `Uint8Array` lookup table に変換し、
Set の identity をキーに `WeakMap` でメモ化している（`greedy-meshing.ts:41-57`）:

```typescript
const _lookupCache = new WeakMap<ReadonlySet<number>, Uint8Array>()
const buildLookup = (ids: ReadonlySet<number>): Uint8Array => { ... }
```

コメントが理由を述べている:
"the resulting lookup is still faster than iterating a Set in the inner meshing loop"。

本リポジトリの `buildLayerLookup` がこれに当たる。ブロック ID はバイトなので
定義域全体が 256 バイトに収まり、内側ループはハッシュ検索ではなく配列インデックスになる。
構築は config あたり O(256) 一回であって、チャンクごとでもセルごとでもない。

### 実測（`pnpm bench`）—— 「桁違い」の訂正

`scripts/bench-meshing.ts` が 1 チャンク分の 393,216 回のルックアップ上で実測している
（M4 Max / Node 22.23.1、5 回通しの中央値）:

| 比較 | 比 |
| --- | --- |
| Effect `HashSet.has` 対 `Uint8Array` ルックアップ | **12.2x** |
| native `Set.has` 対 `Uint8Array` ルックアップ | **6.5x** |
| Effect `HashSet.has` 対 native `Set.has` | **1.9x** |

`opacity.ts` は `HashSet` を native `Set` より「桁違いに遅い」と書いているが、
**実測は 1.9 倍**であって桁違いではない。結論は変わらず、理由が変わる:
効いているのは `HashSet` 対 `Set` ではなく **`Set` 対 `Uint8Array` ルックアップテーブル**（6.5x）で、
合わせた 12.2x が「内側ループを配列インデックスにする」ことの本当の値打ちである。
本節が「native Set でも内側ループには遅すぎる」と書いているのは正しく、数字はそちらを支持している。

### 回帰テスト

`test/public-api.test.ts`:

- `the transparency sets are NATIVE Set, never Effect HashSet`
  —— `EMPTY_MESH_CONFIG` の 2 つの集合が `Set` の instance であることを検査。
- `the layer lookup table covers every representable block id`
  —— lookup が `layerOfBlockId` と全 256 値で一致することを検査。
  lookup の構築がずれたら落ちる。

`pnpm bench`（`verify` には入らない。`testing.md` §7）:

- guard `set-membership/hashset-vs-lookup-table` 他 2 本 —— 上表の比を baseline に対して検査する。
  型テストは入れ替えを捕まえるが、入れ替えの**値段**は言わない。レビューで効くのは後者である。

---

## M-2 `meshing-get-block-is-allocation-free`

### plan.md §3.3 の記述

> `getBlock()` は境界チェックをインライン化し Option 割り当てを避ける（いずれも参照実装で実測確定）

### 参照実装の証拠

`packages/rendering/infrastructure/meshing/greedy-meshing-ao.ts:6-9`（原文、`public-api.md` §4 にも引用）。

- 境界チェックは 6 節の短絡 `if` を関数本体に**直接**書いてある。ヘルパ呼び出しも
  `Option.fromNullable` も無い。
- 返り値は素の `number`。範囲外は `AIR` 定数（`AIR = 0`、`greedy-meshing-types.ts:40`）。
- `!` は indexed access の `| undefined` を落とすためだけに使われている。

呼び出し元は `greedy-meshing-algorithms.ts:39, 78, 117, 156, 195, 234`（面パスごとに 1 回）
に加えて fluids / plant / fluid-state。

さらに AO ヘルパ（`aoXPos` / `aoXNeg` / ...、`greedy-meshing-ao.ts:15+`）は
`getBlock` すら経由せず、事前計算した `xOffset` / `zOffset` で `blocks[]` を直接引き、
自前の guard clause で境界を見ている。ホットさの度合いに応じて段階がある。

### 範囲外が `AIR` である意味

これはフォールバックではなく**意味的に正しい答え**である。
隣接チャンクが未ロードの境界は「開いている」ものとしてメッシュされるべきで、
そうすればストリーミング中のプレイヤーは黒い壁ではなく地形を見る。

### 実測（`pnpm bench`）

`Option` を返す版は素の `number` を返す版の **2.2 倍**（1 チャンク分 393,216 回の近傍読み出し、
M4 Max / Node 22.23.1、5 回通しの中央値）。

ゲート本体は guard `neighbour-read/shipped-vs-frozen-inline-reference`——
出荷している `getBlock` を**その現在の形の凍結コピー**と比べる。
書き換え版と比べるだけでは足りない: 比はどちらの辺が変わっても同じ向きに動くからである。

検証済み: `getBlock` を「境界チェックをヘルパに切り出し `Option` を経由する」もっともらしい
リファクタに一時的に書き換えると、このゲートは 0.944 → 0.392 に落ち、
`meshChunk` は実際に **3.1 倍**遅くなり、`pnpm bench` は 6 件の regression で exit 1 する。

### 回帰テスト

`test/mesh.test.ts`:

- `returns AIR for every out-of-range coordinate instead of throwing or returning undefined`
  —— 6 方向すべての範囲外を検査。
- `agrees with blockIndex over the whole chunk, so the storage layout is the documented one`
  —— レイアウトが文書どおりであることを全域で検査。参照実装の fixture 互換性の前提。

---

## M-3 `meshing-two-transparency-sets`

### plan.md §3.3 の記述

> `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}`（優先度 transparentSolid > water > opaque）

### 参照実装の証拠

`packages/worker/infrastructure/meshing/meshing-worker-config.ts:7-13` の原文は
`public-api.md` §2 に引用。**透過集合は 2 つあり、1 つの boolean フラグではない。**

参照実装のテストが区別を明示的に保持している:
`packages/worker/test/meshing-worker-config.test.ts:69` —— "does not include WATER (fluid, not transparent-solid)"。

振り分けの優先度は `greedy-meshing-passes.ts:148-152` の入れ子三項演算子で、
transparentSolid が water に勝つ。

### なぜ boolean では足りないのか

描画方法が違う:

- **water**: 専用シェーダ（波紋・屈折・アニメーション水面・可変高さ）
- **transparentSolid**（ガラス・葉）: 通常のブロックアトラス材質 + アルファブレンド

1 つの boolean に畳めば、どちらかが必ず間違って描かれる。第 3 の選択肢は無い。

### 回帰テスト

`test/mesh.test.ts`:

- `routes water to the water layer and glass to the transparentSolid layer, not to opaque`
- `with an empty config every block is opaque — the sets really are the only source of truth`
- `transparentSolid beats water when a block id is claimed by both sets`

`test/public-api.test.ts`:

- `the layer priority is transparentSolid > water > opaque, in that order`

---

## M-4 `meshing-face-order-is-canonical`

### 根拠

plan.md §3.3 の「ゴールデンテスト（chunk fixture → バッファのハッシュ比較）」は、
出力順が安定していないと成立しない。順序は**偶然の呼び出し順ではなく値**でなければならない。

参照実装の証拠は `public-api.md` §3 の表（`greedy-meshing.ts:122-128` の呼び出し順と、
`greedy-meshing-algorithms.ts` の各関数の法線・role）。

### 面数の上限について（plan.md の要求との差）

plan.md §3.3 は「面数上限」を性質テストとして要求しているが、
**参照実装の production コードには面数のハード上限は無い**（実測）。あるのは:

- ソフトな事前確保: `greedy-meshing-accumulator.ts:7-9` の `INITIAL_QUAD_CAPACITY = 8192` と、
  超えたら**倍化**する `ensureCapacity()`（:68）。コメントいわく
  「pre-sized typed arrays for ~95% of chunks without reallocation... amortized O(1)」。
  つまり上限で切るのではなく無制限に伸びる。
- **テストレベル**の上限: `packages/rendering/test/greedy-meshing-efficiency.test.ts:55` の
  `expect(...indices.length / 6).toBeLessThan(1536)`。1536 = 16×16×6 で、
  1 層 16×16 をマージなしで出したときの面数。
- 実行時に作業量を減らす唯一の仕掛けは `yLimit`（`greedy-meshing.ts:94-101`。
  最高の非 air ブロックを走査して求める）。

本リポジトリも同様に、上限は**テストの中の不変条件**として持つ。

### 回帰テスト

`test/mesh.test.ts`:

- `emits faces grouped by direction, in the canonical +X -X +Y -Y +Z -Z order`
- `is deterministic: meshing the same chunk twice produces identical quad sequences`
- `face count never exceeds six per non-air cell, whatever the arrangement`（プロパティテスト）

`test/public-api.test.ts`:

- `the canonical face order is +X -X +Y -Y +Z -Z, which every golden hash depends on`
  —— 法線と role も同時に固定する。
- `every face has an opposite, and taking it twice is the identity`

---

## M-5 `meshing-result-is-owned-not-aliased`（参照実装からの意図的な逸脱）

### 参照実装の危険

`greedy-meshing-types.ts:72-80` のコメントが自ら警告している:

```
// Zero-copy subarray views — valid until next greedyMeshChunk call (aliases accumulator backing store).
```

つまり `greedyMeshChunk` の返り値は、次の呼び出しまでしか有効でない。
`toMeshed()` を呼ばずに保持すると、次のチャンクのデータを見ることになる。

### 本リポジトリの選択

`meshChunk` は所有されたデータを返す。プールされた view ベースの高速経路は、
**ベンチマークが用意できてから**明示的な opt-in として追加する。

正しさが先、速さは後。しかも速い版は遅い版に対してテストできる。

### 回帰テスト

現時点では view を返さないので、破れる不変条件が無い。
プール版を入れるときに「所有版と同じ結果を返す」テストを追加すること。

---

## M-6 `meshing-shared-faces-are-culled`

### 根拠

面 cull の中核不変条件。隣接する 2 ブロックは 12 面ではなく **10 面**を出す。

- 12 面 → どちらの側も cull されていない
- 11 面 → 片側だけ cull されている。これは「片面だけ見えない壁」として現れる非対称バグ

同レイヤ同士も面を出さない。これが無いと湖の内部が quad の壁になる。

### 回帰テスト

`test/mesh.test.ts`:

- `two adjacent blocks produce ten faces, not twelve: the shared face is culled from both sides`
  —— 6 方向すべてで検査。
- `two adjacent water cells have no surface between them`
- `an N x N flat layer of stone has an exactly predictable face count`
  —— `2N² + 4N`。マージ実装後も**被覆は変わらない**ことの基準になる。
- `a solid block behind glass still renders: transparent solids do not occlude`
  —— 遮蔽が**隣接ブロックの**不透明度で決まり、面を出す側の不透明度では決まらないことを固定。
  石は 6 面すべてを保つ（ガラス越しに見える）が、ガラスは石に押しつけられた面を 1 つ失う。
  この非対称は正しい。

---

## M-7 `meshing-boundary-open-when-neighbour-absent`

### 根拠

M-2 の帰結。隣接チャンクが未ロードなら air として読み、境界は開いているものとしてメッシュされる。
逆に隣接チャンクがロード済みなら、境界を跨いで遮蔽が効き、seam が二重にならない。

### 回帰テスト

`test/mesh.test.ts`:

- `an absent neighbour reads as air, so the chunk meshes as open rather than as a black wall`
- `a present neighbour occludes across the boundary, so seams do not double up`

---

## 参照実装の数値の訂正

| plan.md | 実測 |
| --- | --- |
| meshing 3 ファイルで 3,994 LOC | 名指しの 3 ファイルは **343**。メッシングモジュール全体（23 ファイル）で **3,830**。詳細は `porting.md` |

`transparentBlockIds` がネイティブ `Set` であるという記述は**正しい**（M-1 で検証）。
