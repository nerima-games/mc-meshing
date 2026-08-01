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
| Effect `HashSet.has` 対 `Uint8Array` ルックアップ | **12.3x** |
| native `Set.has` 対 `Uint8Array` ルックアップ | **6.5x** |
| Effect `HashSet.has` 対 native `Set.has` | **1.9x** |

`opacity.ts` は `HashSet` を native `Set` より「桁違いに遅い」と書いているが、
**実測は 1.9 倍**であって桁違いではない。結論は変わらず、理由が変わる:
効いているのは `HashSet` 対 `Set` ではなく **`Set` 対 `Uint8Array` ルックアップテーブル**（6.5x）で、
合わせた 12.3x が「内側ループを配列インデックスにする」ことの本当の値打ちである。
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
リファクタに一時的に書き換えると、このゲートは 0.98 付近から 0.392 に落ち、
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
- `emits, WITHIN one direction, in the order that direction's slice axis forces`
- `is deterministic: meshing the same chunk twice produces identical quad sequences`
- `face count never exceeds six per non-air cell, whatever the arrangement`（プロパティテスト）

### 方向内の順序はグリーディマージで動いた（正準な方向順は動いていない）

この項は当初「方向内では `lx` → `lz` → `y`」も固定していた。**マージはそれを保てない。**
最大矩形は平面ごとに探すほかなく、面の法線軸が最外ループになるので、
+Y/-Y では `y` が —— 旧順序で最内だった軸が —— 最外に来る。現在の順序は方向ごとに:

| 方向 | 順序 |
| --- | --- |
| `xPos` / `xNeg` | `lx` → `lz` → `y`（素朴実装と同一） |
| `yPos` / `yNeg` | `y` → `lx` → `lz` |
| `zPos` / `zNeg` | `lz` → `lx` → `y` |

**`FACES` の 6 方向の順序は不変である。** この項の名前が指しているのはそちらであり、
そちらは動いていない。本リポジトリにゴールデンハッシュのファイルは無いので
再生成したものは無いが、mc-render がバッファ全体のハッシュを取っているならそれは動く。
`testing.md` §4 に詳細。

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

## M-8 `lod-reduction-is-anisotropic`

### 根拠

`responsibility.md` §3.4 が決着させた分割にしたがい、参照実装の
`lod-simplification.ts`（288 LOC）のうち**距離を取らない半分**を移植した
（`domain/lod.ts`）。`simplifyMesh` / `packQuadKey` / `LodLevel` / `LOD_LEVELS` /
`LodLevelSchema` がこちら、`lodForDistance` / `LOD1_DISTANCE_CHUNKS` /
`LOD2_DISTANCE_CHUNKS` は mc-render である。

### 何を測ったか —— これは**数え上げ**であってベンチマークではない

`simplifyMesh` は決定論的な関数であり、fixture も決定論的である。したがって
「LOD 1 が quad を何枚落とすか」には時計が 1 つも入らない。**機械非依存で厳密**であり、
tolerance も baseline も要らない。`pnpm bench` はこの表を timing の隣に印字するが、
baseline との比較対象には**していない**。

opaque レイヤのみ（water / transparentSolid は参照実装同様に手を触れない）:

| fixture | LOD 0 | LOD 1 | LOD 1 の削減 | LOD 2 | LOD 2 の削減（対 LOD 0） | LOD 2 の削減（対 LOD 1） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| flat | 4,608 | 2,176 | **-52.8%** | 1,056 | -77.1% | -51.5% |
| rolling | 5,558 | 3,008 | **-45.9%** | 1,777 | -68.0% | -40.9% |
| checkerboard-worst | 12,288 | 10,240 | **-16.7%** | 4,608 | -62.5% | -55.0% |
| layered-water-glass | 3,776 | 1,760 | **-53.4%** | 848 | -77.5% | -51.8% |

### 効き方が**軸で違う**（この項の名前の由来）

Y は決して snap しない —— 側面の垂直方向の広がりは丘のシルエットそのものであり、
LOD 段をまたぐたびに山の高さが変わればプレイヤーは「距離」ではなく「ポップ」と読む。
参照実装も同じ判断をしており、この移植もそれを保っている。

その帰結として、上下面（法線が ±Y）は**両方の軸**が snap されるので `step²` で潰れ、
側面は**片方だけ**なので `step` でしか潰れない:

| fixture | 上下面 LOD 0 → 1 → 2 | 側面 LOD 0 → 1 → 2 |
| --- | --- | --- |
| flat | 512 → 128 → 32（÷4, ÷4） | 4,096 → 2,048 → 1,024（÷2, ÷2） |
| rolling | 512 → 252 → 155 | 5,046 → 2,756 → 1,622 |
| checkerboard-worst | 4,096 → 2,048 → 512（÷2, ÷4） | 8,192 → **8,192** → 4,096（÷1, ÷2） |
| layered-water-glass | 512 → 128 → 32 | 3,264 → 1,632 → 816 |

**checkerboard の側面が LOD 1 で 1 枚も減らない**のは偶然ではない。市松では z 方向に
1 つおきにしかブロックが無いので、`lz` と `lz+2` は 2-グリッドの別セルに落ちて衝突しない。
4-グリッドで初めて同居する。**LOD 段が地形の空間周波数と噛み合わなければ削減は 0 である**、
という事実がそのまま出ている。

参照実装のヘッダは「LOD 1 で頂点数 ~25-30%」「LOD 2 で ~6-10%」と書いているが、
**本リポジトリの fixture のどれもそこには届かない**（最良で 47%、最悪で 83%）。
矛盾ではない: あの数字は上下面が支配的なメッシュについての主張であり、
上の表の側面の行がその条件が成り立たない理由である。

### 数字の**上限性** —— 上限だったことが実測で確定した

上の表は**素朴メッシュ**（quad はすべて 1x1）に対する値である。
これは「最も細かく割れた」状態であり、**LOD が最も稼げる入力**である。
旧記述は「グリーディマージが着地すると平坦面は 1 枚の大きな quad になり、
snap しても衝突する相手がいなくなるので LOD の取り分はここから減る。
**したがって上の表は削減率の上限である。** 実測すべき下限は、
グリーディマージ着地後に同じ表を取り直したときの値である」と述べていた。

**取り直した。上限どころではなく、3 つの fixture で取り分はゼロになった。**

| fixture | LOD 1（素朴） | LOD 1（マージ後） | LOD 2（素朴） | LOD 2（マージ後） |
| --- | ---: | ---: | ---: | ---: |
| flat | -52.8% | **-0.0%** | -77.1% | **-0.0%** |
| rolling | -45.9% | **-2.9%** | -68.0% | **-9.5%** |
| checkerboard-worst | -16.7% | -16.7% | -62.5% | -62.5% |
| layered-water-glass | -53.4% | **-0.0%** | -77.5% | **-0.0%** |

#### AO 着地後に**もう一度**取り直した —— この表が予告していた方向に動いた

上の「マージ後」列は AO 導入**前**の値である。M-10 で AO がマージキーに入り、
陰影の違う面が割れるようになったので、簡約が拾える相手が戻ってきた:

| fixture | LOD 1（マージのみ） | LOD 1（マージ + AO） | LOD 2（マージのみ） | LOD 2（マージ + AO） |
| --- | ---: | ---: | ---: | ---: |
| flat | -0.0% | **-0.0%** | -0.0% | **-0.0%** |
| rolling | -2.9% | **-7.9%** | -9.5% | **-17.9%** |
| checkerboard-worst | -16.7% | -16.7% | -62.5% | -62.5% |
| layered-water-glass | -0.0% | **-0.0%** | -0.0% | **-0.0%** |

**動いたのは rolling だけであり、それが正しい。** flat と layered の水平面は
AO が一様なので割れず（M-10 の「平らな板は自己遮蔽しない」）、
LOD 0 の quad 数が変わらないので簡約の取り分も変わらない。
checkerboard はそもそもマージが起きないので AO も何も割らない。
rolling だけが凹んだ地形を持ち、そこだけ面が増え、増えたぶんが粗い格子の上で衝突する。

**これは本節がすでに予告していた現象である。** 上の「なぜ効かなくなったか」の説明は
参照実装のプロパティテストを引いて「一様な光の下ではグリーディが平面を 1 枚にまとめてしまうので
LOD は何も回収できず、**ライティングで面が割れて初めて LOD が効くようになる**」と書いていた。
AO はライティングではないが、**面を割るという一点で同じ働きをしている**。
`responsibility.md` §3.5(c) の結論はこの数字で引き直してある。

`pnpm bench` は**両方の表**を印字する。マージ済みのほうが mc-render が実際に受け取るもので、
素朴のほうが上の元表の出どころである。両方無いと「LOD が効かなくなった」のか
「LOD が壊れた」のかが区別できない。

参照実装のテストがまさにこれを予告していた
（`packages/rendering/test/lod-simplification.property.test.ts`）: 一様な光の下では
グリーディが平面を 1 枚にまとめてしまうので LOD は何も回収できず、
ライティングで面が割れて初めて「LOD が効く」ようになる、と。
**本リポジトリにはまだライティングが無い**ので、いまは「一様な光の下」に相当する。
光が入れば面はまた割れ、この表の数字は上がる。

`responsibility.md` §3.5(c) がこの数字を mc-render 向けの結論に引き直している
（`renderDistance = 4` で LOD 1 が買うのは quad の 1.2%、代金は約 11 px のずれ）。

### 簡約の**費用**（こちらは timing なので比で扱う）

workload 比（yardstick 除算後、5 回通しの中央値。`bench-baseline.json`）:

| fixture | `meshChunk` | `simplifyMesh` LOD 1 | LOD 2 | 簡約 ÷ メッシング |
| --- | ---: | ---: | ---: | ---: |
| flat | 10.77 | 7.26 | 6.86 | 0.67x |
| rolling | 10.66 | 8.85 | 8.45 | 0.83x |
| checkerboard-worst | 7.97 | 23.08 | 19.87 | **2.90x** |
| layered-water-glass | 11.39 | 5.80 | 5.60 | 0.51x |

**簡約はメッシングと同じ桁の費用であり、最悪ケースでは 3 倍近く高い。** 393,216 セルを
6 回舐めるメッシングより、12,288 枚の quad を 1 回舐める簡約のほうが高くつくということで、
効いているのは quad ごとのオブジェクト生成と `Set<number>` への挿入である。
mc-render にとって重要な帰結: **LOD の切り替えはフレームごとに走らせてよい処理ではない**。
段が変わったチャンクについて 1 回だけ走らせ、結果を保持すること。

### 参照実装からの意図的な逸脱（3 点）

1. **`snapInterval` の退化ガードを移植していない。** 参照実装は `snapMin === snapMax`
   のとき幅を `step` に広げる（自身で `c8 ignore` と注記しており到達しない）。
   面積 0 の quad を step x step の**存在しない面**に膨らませるのは、
   退化したまま通すより悪い答えである。
2. **「opaque だけ簡約する」規則の置き場所を変えた。** 参照実装は呼び出し側で
   `simplifyMesh(meshed.opaque, lod)` と書く（`meshing-worker.ts:135`,
   `meshing-worker-sync.ts:98`）。本リポジトリの `MeshLayers` は 3 レイヤを束ねて運ぶので、
   規則を関数の**中**に 1 回だけ書いた。2 人目の呼び出し側が忘れられなくなる。
3. **`Quad.width` / `height` がどの軸かを確定させた**（`domain/faces.ts` の `tangentAxes`）。
   これまで「第 1 / 第 2 接線軸」としか書かれておらず、**どの軸かは決まっていなかった**。
   全 quad が 1x1 のうちは無害だが、extent を読む側（LOD、そして次のグリーディマージ）が
   出す側と違う推測をすると、面数が変わらないまま形だけがずれる。
   規約は「法線でない 2 軸を x, y, z の順に」である。

### 回帰テスト

`test/lod.test.ts`（25 本）:

- `lod-zero-is-identity` —— LOD 0 は入力オブジェクトそのものを返す（近傍リングの常態）
- `lod-simplify-is-pure` —— `(layers, level)` だけの関数。入力を書き換えない
- `lod-preserves-silhouette` —— 水平方向だけ snap し、Y は snap しない
- `lod-never-opens-a-hole` —— 元の quad はすべて、同じ向きの生き残り quad に**包含される**
- `lod-preserves-emission-order` —— メッシャが渡した順序をそのまま保つ。
  **簡約後のメッシュにもゴールデンハッシュがそのまま取れる**ということ。
  マージ着地時に「方向内は lx→lz→y」という書き方をやめ、
  **メッシャの順序を知らない形**（出力列が入力列の部分列であること）に書き換えた ——
  そうしないとメッシャの 3 通りの順序表をテスト側にも複製することになる
- `lod-reduction-is-anisotropic` —— **素朴メッシュ**の 4x4x1 の板で上下面 ÷4、側面 ÷2 を
  厳密な数として固定。入力を `meshChunkNaive` に変えたが、主張も値も変えていない ——
  これは元から `simplifyMesh` のテストであってメッシャのテストではない
- `lod-reduction-collapses-after-merging` —— **マージ済み**の同じ板からは
  LOD 1 でも LOD 2 でも 1 枚も落ちない（6 枚 → 6 枚、位置も範囲も不変）

`packQuadKey` は 3^9 = 19,683 通りの**全数**（各成分の両端と 0 の次）で単射性を検査する。
基数の off-by-one は繰り上がりでしか衝突しない（`p2z = 16` 対 `p2y = 1`）ので、
1.5e11 の空間からの無作為抽出では実質的に当たらない。

---

## M-9 `meshing-merge-covers-the-same-surface`

### 根拠

plan.md §3.3 の責務そのもの ——「チャンクデータ→ジオメトリバッファの純粋変換
（**グリーディメッシング**）」。参照実装の `runGreedyExpansion`
（`greedy-meshing-passes.ts:64-97`）を、AO と光のパッキングを外して移植した。

### マージ対象は opaque、キーは `blockId` と AO

transparentSolid / water は描画順や将来のセル固有属性を矩形内部へ隠さないため、マスクへ入れず
単位 quad のまま出力する。専用 fluid と plant もそれぞれの生成器で単位 primitive を維持する。
opaque のうち同一方向・同一スライス・同一 `blockId`・同一 AO の面だけがまとまる。

| 禁止事項 | なぜ起きえないか |
| --- | --- |
| レイヤをまたぐ | opaque だけをマスクへ入れる。transparentSolid / water は単位 quad として直接出力する |
| ブロック種別をまたぐ | ID そのものがキーである |
| AO をまたぐ | AO は mask cell の bit 8-9 に入り、値が異なるセルでは矩形が止まる |
| 遮蔽の違う面をまたぐ | 遮蔽はマスクを書く**前に**判定する。隠れている面はマスクに入らず、マスクの零値は `AIR` で、展開は `AIR` を突き抜けない |

`role` は `direction` の関数で、方向ごと・slice ごとに別パスなので mask cell に重ねて持たない。

### 何を測ったか —— quad 削減は**数え上げ**であって timing ではない

| fixture | 素朴 | マージ後 | 削減 | 被覆面積（両実装で一致） |
| --- | ---: | ---: | ---: | ---: |
| flat | 4,608 | **10** | **-99.8%** | 4,608 |
| rolling | 5,558 | **768** | **-86.2%** | 5,558 |
| checkerboard-worst | 12,288 | **12,288** | **0.0%** | 12,288 |
| layered-water-glass | 5,376 | **1,612** | **-70.0%** | 5,376 |

checkerboard の 0.0% は欠陥ではない。`(lx+y+lz)%2` は同じ向きの面が 2 つ隣り合う場所を
1 つも作らないので、まとめられる対が存在しない。**これがグリーディメッシングの最悪ケースの定義である。**

「被覆面積」列は結果ではなく**検算**であり、`pnpm bench` が毎回両実装で計算して突き合わせる。

### wall-clock —— マージは**遅くする**。速くしたのは `solidCeiling` である

ここを混ぜると嘘になるので分けて書く。`meshChunk` は 4 shape すべてで `meshChunkNaive` の
0.4-0.5 倍の時間で終わるが、**マージと同時に `solidCeiling`（参照実装の `yLimit`。
最高の非 air ブロックより上を走査しない）を入れたためである。**

`solidCeiling` を強制的に無効化して（`= CHUNK_HEIGHT` に固定して）測り直すと:

| fixture | 素朴（256 走査） | マージ（256 走査） | マージ単体の比 |
| --- | ---: | ---: | ---: |
| flat | 1.378 ms | 1.604 ms | **1.16x 遅い** |
| rolling | 1.403 ms | 1.678 ms | **1.20x 遅い** |
| checkerboard-worst | 1.148 ms | 1.686 ms | **1.47x 遅い** |
| layered-water-glass | 1.420 ms | 1.861 ms | **1.31x 遅い** |

**マージ単体は 4 shape すべてで遅く、checkerboard で最も遅い。**
グリーディメッシングは**時間を払って三角形を買う**取引であり、
checkerboard ではその見返りがゼロなのでマスク構築と掃引が丸ごと純損失になる。
これは想定どおりであって回帰ではない。

再現手順: `domain/mesh.ts` の `const yLimit = solidCeiling(chunk.blocks)` を
`const yLimit = solidCeiling(chunk.blocks) === 0 ? 0 : CHUNK_HEIGHT` に置き換えて
`nix develop --command pnpm bench` を走らせ、`meshChunk/*` の ms を読む。

### 回帰テスト

`test/mesh.test.ts`:

- `meshing-merge-covers-the-same-surface` —— `merged output covers exactly the same
  block-faces as unmerged output`。各 quad を単位面へ展開し `meshChunkNaive` と
  **多重集合として**一致することを、任意のチャンク（箱塗り生成）と任意の隣接構成で検査する。
  **集合ではなく多重集合**であることが要点で、1 行ぶん重なるバグは集合を変えず多重集合を変える
- `REGRESSION: no two merged quads claim the same block-face` —— 重複被覆（＝ z-fighting）単独
- `meshing-merge-never-crosses-a-block-boundary` —— `never merges two different block ids,
  however they are arranged`。面数も面積も変わらないので、数える種類のテストでは見えない
- `REGRESSION: greedily merges opaque faces but keeps transparent faces as unit quads`
- `never emits more quads than the naive mesher, and usually far fewer` ——
  後半（実際に減っていること）が無いと、**マージを一切しない実装でも被覆の性質は通る**
- `the Y scan ceiling` の 3 本 —— `solidCeiling` の off-by-one は世界の最上段を黙って消す。
  他のテストはすべて y=64 以下を使うので、これが無いと全部 green のまま通る

### オラクルを `domain/` に置いた理由

`meshChunkNaive` は `test/` ではなく `domain/mesh.ts` にあり、export されている。
`test/` にコピーを置けば、オラクルの側が黙って drift できてしまう。
両者は `isFaceExposed` を**共有している**が、これは意図的である ——
この性質が捕まえるべきなのは**マージのバグ**（セルの取りこぼし、二重被覆、
width と height の取り違え）であって、どの面が見えるかは別の問いであり、
そちらは M-3 / M-6 / M-7 が既に固定している。

---

## M-10 `meshing-merge-splits-on-ambient-occlusion`

### 根拠

`responsibility.md` §3 がアンビエントオクルージョンを「保留 —— まず基本を固める」としていた。
基本（グリーディマージ）は M-9 で固まったので保留の理由が消え、参照実装の
`greedy-meshing-ao.ts`（149 LOC）のうち **AO の半分**（`aoXPos` .. `aoZNeg`、:15-87）を
移植した（`domain/ambient-occlusion.ts`）。
残り半分の光サンプリング（`sampleVoxelLight` / `sampleCornerLight`、:95-149）は
`LightGrids` を読むので**移植していない** —— ライトグリッドは §3 により mc-worldgen の所有であり、
本リポジトリはまだ読むものを持たない。

### 最初に潰しておくべき誤解 —— 参照実装の AO は**頂点ごとではなく面ごと**である

作業指示は「AO は角の 8 近傍から**頂点ごとに**決まるので、AO の異なる 2 面はマージできない」
という前提で来た。**参照実装についてはこれは誤りである。** 事実は:

| | 有名な定式化（0fps / Minecraft 本家） | 参照実装 |
| --- | --- | --- |
| 単位 | 頂点ごと（1 quad に 4 値） | **面ごと（1 quad に 1 値）** |
| サンプル数 | 角あたり 8 ボクセル | **4 セル**（面前の空気セルの接線方向 4 近傍） |
| 出典 | — | `greedy-meshing-ao.ts:15-25` ほか 5 本 |

決定的な証拠は `greedy-meshing-passes.ts:154` である —— `aoQuad[0] = ao; aoQuad[1] = ao;
aoQuad[2] = ao; aoQuad[3] = ao`。**4 頂点に同じ 1 つの値を書いている。**
参照実装で角ごとに違うのは AO ではなく**光**（`sky corner 0..3` / `block corner 0..3`）である。

この区別は装飾ではなく、マージとの関係を丸ごと決める:

- **頂点ごとの AO ならマージ済み quad は定義できない。** 16x1 の走りには角が 4 つではなく 17 個ある。
  頂点 4 値で再現できる組み合わせは存在しないので、補間するか再分割するかしかない。
  作業指示が述べた衝突は、この定式化についてなら**正しい**。
- **面ごとの AO なら衝突しない** —— ただし値を**マージキーに入れる**なら。
  そうすれば quad が覆う全セルが構成上同じ AO を持ち、その 1 値がその quad の値である。

### 決定: AO はマージキーに入る。参照実装がそうしているから、かつ他に置き場が無いから

参照実装は `packMask` で blockId を bit 0-7、量子化した AO を bit 8-9 に詰め
（`greedy-meshing-passes.ts:24-45`）、`runGreedyExpansion` は**セル値全体が一致する間だけ**
矩形を伸ばす（:77, :84）。つまり参照実装は AO が一致する 2 面しかマージしない。
コメントが明言している（:20-22）:

> All four corner lights participate in mask-value equality, so greedy expansion
> only merges quads with identical lighting+ao+blockId — the expected vanilla trade-off

**「マージ後に AO を適用する」案は成立しない。** AO の異なるセルにまたがる quad には
正しい単一値が存在しないので、どれか 1 つを選ぶ（面積の大半で目に見えて違う陰影）か、
また分割する（＝これを、後から、二度手間で行う）しかない。

本リポジトリの実装は同じ配置（bit 0-7 / bit 8-9）だが、マスクは `Uint32Array` ではなく
**`Uint16Array`** である。参照実装が 26 bit 要るのは 8 つの角光を並べて詰めるからで、
ID と AO だけならキーは 10 bit に収まり、スライスごとの `fill` が触るバイト数が半分になる。

### 被覆同値性（M-9）は**壊れていない。むしろ強くなった**

`ambientOcclusionAt` は「チャンク・隣接・方向・セル」だけの純関数であり、
**どの面が露出するか**には一切関与しない。関与するのは露出した面の**まとめ方**だけである。
したがって:

- `totalQuadArea` は不変。4 fixture すべてで素朴実装と一致する（下表「被覆面積」列）。
- 単位面の**多重集合**も不変。

そのうえで `test/mesh.test.ts` の `unitFacesOf` は文字列に `ao` を**追加した**。
これは主張の変更ではなく**強化**である —— マージ済み quad の 1 つの AO 値を、
それが覆う全単位面に書き出し、マージを一切しない `meshChunkNaive`
（こちらも AO を計算する）とセル単位で突き合わせる。
無ければ被覆テストは幾何だけを固定し、**AO が実際に変えた側**については何も言わない。

**既存のテストで弱めたものは 1 本も無い。** 面数を主張していた既存アサーション
（孤立 1 ブロック = 6、隣接 2 ブロック = 6、N×N 平板 = 6、full slab = 6 …）は
**1 つも動かなかった**。理由は機構的で、それ自体が結果である:
平坦面の上の空気セルの接線 4 近傍はすべて空気なので、**平らな板は自己遮蔽しない**。
AO が値を持つのは凹んだ形（内側の角、庇、段差）だけであり、既存の fixture にそれが無かった。
これは「AO のテストが足りていなかった」ということでもあるので、
新しい fixture は意図的に庇と壁を持つ。

### 何が動いたか —— quad 削減（**数え上げ**。timing ではない）

| fixture | 素朴 | マージ（AO 前） | マージ（AO 導入時） | **現行（opaque 限定）** | 現行削減 | 被覆面積 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| flat | 4,608 | 10 | 10 | **10** | **-99.8%** | 4,608 |
| rolling | 5,558 | 768 | 960 | **960** | **-82.7%** | 5,558 |
| checkerboard-worst | 12,288 | 12,288 | 12,288 | **12,288** | **0.0%** | 12,288 |
| layered-water-glass | 5,376 | 17 | 35 | **1,612** | **-70.0%** | 5,376 |

**AO の代金は quad 全体で +192（rolling）であり、flat と checkerboard では 0 である。**
layered の 35 → 1,612 は AO の代金ではない。opaque 限定後は opaque 12枚だけを統合し、
water 1,024枚とglass 576枚を単位面で保つため1,612枚になる。
4 行それぞれ理由が違い、どれも機構的である:

- **flat が 0 なのは、平らな板が自己遮蔽しないからである。** 上面の全セルで AO=0、
  下面も 0、4 つの縁はチャンク境界に面していて隣接チャンクが無いので 0。10 枚のまま。
- **checkerboard が 0 なのは、そもそもマージできる対が 1 つも無いからである**（M-9）。
  AO はマージを**減らす**ことしかできないので、ゼロからは減らせない。
  ただし**仕事は増えている** —— 露出面 12,288 枚それぞれで 4 回の近傍読み出しが走る。
- **rolling が +25% なのは、これが唯一の凹んだ地形だからである。** 列ごとに高さが違うので
  段差の内側に AO の段差ができ、側面の走りがそこで割れる。
- **AO 導入時に layered が 17 → 35 となったのは、水とガラスが空気ではないからである。**
  ガラス板（y=63）の下面は水（y=62）に面しており、水は `!== AIR` なので遮蔽物として数えられる。
  16x16 の面のうち内部と辺は AO=3、**四隅だけが AO=2** になる（隅では 4 サンプルのうち
  2 つがチャンク外＝空気）。よって 1 枚だった面が 7 枚（16x14 の本体 + 14x1 の 2 本 + 隅 4 枚）に割れる。
  同じことが水面（y=62 の上面）と石の上面（y=50）でも起きる。

**最後の行は「AO の遮蔽物は何か」という未決着の問いがそのまま数字になったものである** —— 次項。

### 定数と規則の出典

| 値 | 出典 | 状態 |
| --- | --- | --- |
| AO の段数 = 4（`AO_LEVELS`） | `greedy-meshing-passes.ts:10`（`bits 8-9  ao quantized [0..3]`） | 出典あり |
| クランプ上限 = 3（`AO_MAX`） | `greedy-meshing-ao.ts:24, 36, 49, 62, 74, 86`（`count > 3 ? 3 : count`） | 出典あり |
| サンプルは面前の空気セルの**接線 4 近傍** | `greedy-meshing-ao.ts:15-25` ほか 5 本 | 出典あり |
| マスク配置 blockId=bit 0-7 / ao=bit 8-9 | `greedy-meshing-passes.ts:8-11` | 出典あり |
| **遮蔽物の判定が `!== AIR` であること** | `greedy-meshing-ao.ts:20-23` ほか | **転記のみ。正当化されていない** |

最後の 1 行を曖昧にしない。**参照実装が `!== AIR` と書いているから `!== AIR` にした。**
その帰結として、`opacity.ts` が「ガラスは面を遮蔽しない」と慎重に定めているのに、
**AO ではガラスも水も遮蔽物として数える。** この非対称が正しいかどうかは
本リポジトリでも参照実装でも**一度も測られていない**。
`occludes()` に差し替えるのは 1 行で、見た目は整うが、それは plan.md §8 が
「参照実装は仕様である。作り直すな」と警告している種類の整理である。
決着させるべき時点はライティングが入るときで、そのとき参照実装は AO と光を同じマスクセルに詰めており、
**両者は「何が光を止めるか」という 1 つの概念を共有したがる**。
テスト（`test/ambient-occlusion.test.ts` の
`any non-air block occludes, water and glass included`）はこの規則を
**移植したとおりに固定してある** —— 変えるなら意図的な決定として変えることになり、
黙って drift することはできない。

これを明示するのは、本プロジェクトで最も多く記録されている欠陥が
「結論は正しく、証拠が間違っている」だからである（`testing.md` 末尾に 5 例）。
ここでは**証拠が無いことのほうを記録する**。

### 参照実装からの意図的な逸脱（1 点）—— チャンク境界を跨いで読む

参照実装はチャンクの端で早期 return する —— `if (lx >= CHUNK_SIZE - 1) return 0`
（`greedy-meshing-ao.ts:16`。5 本の兄弟も同様: :28, :40, :53, :66, :78）。
**0 は最も明るい値である。** つまり参照実装は、地形が連続しているところに
**チャンクごとに遮蔽されていない明るいリング**を描く。

本移植は `getBlockAcrossBoundary` を通す。新しい規則ではなく **M-7 をもう 1 つの読み出しに適用しただけ**である
—— 隣接が無ければ空気として読み、あれば読む。隣接が無いときは参照実装と**厳密に同じ答え**になるので、
この逸脱は参照実装が正しかった場面では無料であり、正しくなかった場面だけを直す。

助けられないのは**対角のサンプル**だけである。空気セルは法線方向に 1 歩、
サンプルはそこから接線方向にもう 1 歩なので、チャンクの角では対角の隣接チャンクに落ちる。
`ChunkNeighbours` は軸方向 4 つしか持たない（§3.3 により座標が無いので対角は名指しすらできない）ので
`getBlockAcrossBoundary` は `AIR` を返す。境界処理の他の場所と同じ「開いているものとして扱う」答えであり、
影響するのはチャンクの垂直な 4 稜だけである。

### wall-clock —— AO は**無料ではない**。realistic で 1.3 倍、最悪ケースで 2 倍

`domain/mesh.ts` は AO を**露出した面についてだけ**計算する（マスクを書く直前）。
セルごとではないので plan.md §3.3 の ~40 万 call/chunk の経路には乗っておらず、
最悪の checkerboard でも 12,288 回、つまりその 3% である。
**それでも安くはなかった。**

測り方が問題になった。この機械は測定中ずっと load average 24-42 で、
`testing.md` §7 が警告しているとおり、その条件では workload 比はほとんど情報を持たない。
そこで **AO 前と AO 後のベンチマークを交互に 5 対走らせた**（同一機・同一負荷・
同一 run の yardstick で割る）。yardstick 自体は 2 つの腕の間で **1.01 倍**であり、
つまり対にしたことで負荷は約分されている:

| workload | AO 前（ms） | AO 後（ms） | 比 |
| --- | ---: | ---: | ---: |
| `meshChunk/flat` | 0.881 | 1.156 | **1.31x** |
| `meshChunk/rolling` | 0.943 | 1.281 | **1.36x** |
| `meshChunk/checkerboard-worst` | 0.610 | 1.250 | **2.05x** |
| `meshChunk/layered-water-glass` | 0.861 | 1.203 | **1.40x** |
| `meshChunkNaive/flat` | 1.739 | 1.950 | 1.12x |
| `meshChunkNaive/rolling` | 1.898 | 2.055 | 1.08x |
| `meshChunkNaive/checkerboard-worst` | 1.598 | 2.077 | 1.30x |
| `meshChunkNaive/layered-water-glass` | 1.768 | 1.988 | 1.12x |

**checkerboard が最悪なのは、M-9 でマージ自身が最悪だったのと同じ理由である。**
露出面が全 fixture 中で最も多く（12,288 枚）、しかもそこではマージが何も回収しないので、
AO の仕事が丸ごと純損失になる。`meshChunk` の側が `meshChunkNaive` の側より比が大きいのは
`solidCeiling` のためである —— 分母がもともと小さいので、同じ絶対量の追加仕事が大きな比に見える。

`bench-baseline.json` は取り直した。**checkerboard の旧値 2.931 に対する新値 5.889 は 2.01 倍**であり、
workload の tolerance はちょうど 2.0 なので、取り直さなければこのゲートは落ちていた。
guard は 5 本とも旧記録の 0.94-1.06 倍に収まっている —— どれも AO を通らないので、これは予想どおりである。

### 最初の書き方は**さらに 3 倍**高かった。2 つとも記録に値する

上の数字は 2 度目のものである。最初の実装は同じ paired 測定で
**flat 2.46x / rolling 2.98x / checkerboard 6.91x / layered 2.78x** だった。
原因は 2 つあり、どちらも「読みやすい書き方」だった:

1. **方向 → オフセット表を `Object.fromEntries(FACES.map(...))` で作っていた。**
   V8 はその結果を **dictionary mode** の backing store で持つので、
   呼び出しごとの表引きが in-object フィールド読みではなく文字列のハッシュ探索になる。
   6 キーのオブジェクトリテラルに書き下すと直る。
2. **4 サンプルを `occluding` というローカル関数に括り出していた。**
   `chunk` / `neighbours` / `lx` / `y` / `lz` を捕捉する**クロージャが呼び出しごとに割り当てられる**。
   1 チャンクあたり最大 12,288 個の短命オブジェクトであり、
   さらに tuple の分割代入がイテレータを 1 つ増やす。4 つの `if` に展開すると割り当てはゼロになる。

**(2) は plan.md §5.2 が `getBlock` について禁じているものと同じ誤りである**
——「`Option` は in-bounds 読み出しごとに `Some` を割り当てる。1 チャンクあたり数十万の短命オブジェクト」——
それを反対側から踏んだ。M-2 が値札を貼っている当の失敗を、隣のファイルで繰り返したことになる。

副次的な影響も測った。`test/mesh.test.ts` は 40 s の timeout を持つプロパティテストを 3 本抱えており
（`MERGE_PROPERTY_TIMEOUT_MS` とその由来のコメント）、最初の書き方ではファイル全体が
**4.19 s → 12.9 s** になっていた。coverage の 3.5 倍係数の下では CI を落としかねない。
直した版は **4.38 s** である。

`domain/ambient-occlusion.ts` の `AO_OFFSETS` と `ambientOcclusionAt` のコメントが
両方を記録している。**「読みやすいほうを書いて、測って、直した」という順序自体が記録の一部である** ——
最初に測っていなければ、2 倍から 7 倍のコストが「AO はそういうものだ」として通っていた。

### 回帰テスト

`test/ambient-occlusion.test.ts`（19 本）:

- `each of the four tangent neighbours of the air cell darkens the face by exactly one`
  —— **1 度に 1 つだけ**置く。4 つ同時に置くとクランプで 3 になり、
  「どの 4 セルを読んでいるか」を区別できなくなる
- `no other neighbour darkens it, including every diagonal the per-vertex algorithm would count`
  —— 対になる半分。空気セル自身・法線 2 歩先・法線の裏・面内 4 対角・
  **発光側セル自身の接線近傍**（＝空気セルではなくブロック側を中心にサンプルする off-by-one）
- `the two tables are disjoint` / `the six directions sample six different sets of cells`
  —— 上 2 本が空振りでないことと、6 方向の表が 1 行に潰れていないこと
- `four occluders report AO_MAX, not four` —— クランプ。2 bit を溢れるとマスクの隣の
  フィールドを踏む
- `is always in range and never decreases when a block is added` —— 単調性（プロパティ）
- `any non-air block occludes, water and glass included` —— 上表の**転記のみ**の行を固定
- 境界 6 本 —— 隣接なし = 参照実装と同じ 0、隣接あり = 遮蔽される、
  面の向いている側の隣接だけを見る、隣接の**接している列**を読む、
  チャンク角の対角は空気、世界の天井と床は空気

`test/mesh.test.ts`:

- `REGRESSION: does not merge two faces whose ambient occlusion differs`
  —— y=64 の 1x2 の走りと、`(8,65,9)` の**庇**。庇は両ブロックに対角なので
  cull には触れず陰影だけを変える。2 枚に割れること、庇を外すと 1 枚に戻ること、
  そして**被覆面積が両方で素朴実装と一致すること**を検査する。
  （素直に思いつく L 字 —— 3 つ目を `(8,64,9)` に置く —— は**使えない**。
  面を共有するので、比べたい当の面が cull される）
- `REGRESSION: a merged quad's ao is the ao of every cell it covers, id 255 included`
  —— マスクの詰め方の round-trip でもある。`AO_SHIFT` が 8 ではなく 7 なら
  ID 255 の最上位ビットが AO のフィールドに乗り、**ブロック 255 の quad だけ**が
  持っていない陰影を報告する。他のどのテストも気づかない

### 落ちることの確認（7 つの変異、すべて赤）

| 変異 | 落ちたテスト |
| --- | ---: |
| クランプを外す（`return count`） | 1 / 19 |
| 接線 2 軸の片方だけを 2 回サンプルする | 5 / 19 |
| 空気セルではなく**発光セル**の周りをサンプルする | 9 / 19 |
| `packFaceCell` から AO を落とす（マージキーを ID だけに戻す） | 3 / 40 |
| `AO_SHIFT` を 8 → 7 | 4 / 40 |
| 素朴オラクルが `ao: 0` を返す | 2 / 40 |
| 参照実装どおりチャンク端で 0 を返す | 2 / 19 |

---

## M-11 `meshing-cross-plants-are-two-opposed-diagonals`

### 根拠

`responsibility.md` §3 が植生メッシュ（十字板）を「保留」としていた。保留の理由（「まず基本を固める」）は
M-9 で消えたので、参照実装の `plant-mesh.ts`（258 LOC）のうち**十字板の部分**を移植した
（`domain/plant-mesh.ts`）。責務表の行が名指ししているのは**十字板**だけであり、
同ファイルの残り（サボテン・レール・スイレン）は移植していない —— 下の「移植していないもの」を参照。

### 十字板は**面ではない**。これが設計上の全問題である

本リポジトリが出す他のすべては `Quad` である —— 原点セル・面方向・整数の 2 つの extent。
これは制限ではなく本体であり、グリーディマージが成立する理由であり、
`simplifyMesh` が箱を格子に snap できる理由であり、
テストが quad を単位ブロック面に展開し直せる理由である。十字板はその**どれにも当てはまらない**:

| | `Quad` | 十字板 |
| --- | --- | --- |
| 平面 | 軸に平行 | **対角**。`FaceDirection` を持てない |
| 座標 | 整数 | **小数**（`PLANT_INSET` だけ内側） |
| 被覆するブロック面 | 1 枚以上 | **0 枚**。`totalQuadArea` に寄与しない |
| マージ | する | **できない**。伸ばす矩形が無い |

したがって `CrossPlantQuad` は**頂点 4 つを明示的に持ち**、3 つの `Quad` レイヤとは別のリストで運ばれる。
`MeshLayers` に 4 つ目のフィールド `crossPlants` が生えた。

**これは plan.md §3.3 が定める `{opaque, water, transparentSolid}` からの逸脱であり、そう記録する。**
ただし選択肢は「逸脱するかしないか」ではない。`Quad` に「小数で方向を持たないモード」を足せば、
`simplifyMesh` を含む全消費者がそこで分岐することになり（しかも snap する extent が無いものを snap しようとする）、
**逸脱は型から見えない場所に移るだけ**である。見える場所に置いた。

`totalQuadArea` / `totalQuadCount` は十字板を**数えない**。あの 2 つはブロック面の量 ——
マージが保存すべき量と減らすべき量 —— を測っており、十字板はそのどちらでもない。
数えれば、マージの中心的不変条件が**花 1 本で破れているように読める**。

### 定数と規則の出典

| 値 / 規則 | 出典 | 状態 |
| --- | --- | --- |
| `PLANT_INSET = 0.1` | `plant-mesh.ts:13` | **転記のみ。正当化されていない** |
| 2 枚が**逆の対角**に張られること | `plant-mesh.ts:96-97` | 出典あり |
| Y は inset しない（`y` から `y+1`） | `plant-mesh.ts:93-94` | 出典あり |
| 十字板は AO を持たない（`EMPTY_AO`） | `plant-mesh.ts:16, 76` | 出典あり |
| 法線が**軸平行**（真の法線ではない） | `plant-mesh.ts:96-97` | **転記のみ** |
| 走査順 `lx → lz → y` | `plant-mesh.ts:238-240` | 出典あり |
| 植物ブロックは 6 パスから除外される | `greedy-meshing-algorithms.ts:40, 79, 118, 157, 196, 235` | 出典あり |
| 十字板は transparentSolid の材質へ | `plant-mesh.ts:245` | 出典あり |

**転記のみの 2 行を曖昧にしない。**

- `PLANT_INSET = 0.1`。参照実装は、自分の薄いブロックに使っている `1/16`（`THIN_BLOCK_INSET`, :14）
  ではなく 10 分の 1 を選んだ理由を書いていない。inset が買うのは z-fighting の回避であり、
  必要量は描画距離におけるデプス精度の関数である。**本リポジトリにレンダラは見えない**ので測れない。
- **法線が軸平行であること。** 1 枚目は `(x0,z0)`-`(x1,z1)` の対角に張られるので真の法線は
  `(1, 0, -1)/√2` だが、参照実装は `[0, 0, 1]` を渡す（:96。2 枚目は `[1, 0, 0]`、:97）。
  訂正せずに転記した。十字板は平坦な陰影で描かれる —— `EMPTY_AO` と、4 隅すべてに同じ 1 ボクセル分の光
  （:51-62）—— ので法線は陰影に使われておらず、ここで直しても**消費者のいない変更**になる。

### 参照実装からの意図的な逸脱（1 点）—— 植物は**何も隠さない**

参照実装の `isSolidFaceExposed`（`greedy-meshing-fluid-state.ts:145-157`）は、
隣接が AIR か transparent-solid のときだけ面を露出させる。**植物はそのどちらの集合にも入っていない。**
したがって参照実装では、**石ブロックの隣に花が咲くとその石の面が cull され、花の向こうの壁が透ける。**

これは決定ではなく欠陥である: 参照実装のどこにもそう書かれておらず、テストも無く、
通常の地形で目立たないのは植物の水平方向の隣接がほぼ常に空気だからにすぎない。

本移植では、十字板の隣接は `isFaceExposed` において**空気と完全に同じ**に扱う。
セルの 10 分の 1 を占める 2 枚の対角パネルが何かを遮蔽できるはずがないので、
これは好みではなく**意味的に正しい答え**である。`test/plant-mesh.test.ts` が 6 方向すべてで固定している。

なお **AO のほうは植物を遮蔽物として数える**（M-10 の `!== AIR`）。
2 つの規則は植物について食い違っており、**ガラスについてすでに食い違っているのと同じ形**である。
これも隠さずテストに書いてある（`a plant does not darken its neighbours' ambient occlusion either`
という名前の下で、実際には**darken する**ことを記録している）。

### どのブロックが植物かは**注入する**

参照実装は名指しする —— `blockTypeToIndex('DANDELION')` ほか 8 種（`plant-mesh.ts:18-28`）。
本リポジトリはブロックレジストリを持たない（§3.2）ので、集合は `MeshConfig` 経由で届く。
`waterBlockIds` / `transparentSolidBlockIds` と同じであり、理由も同じ 3 つである。

**これは第 3 の集合であって、レイヤモデルの第 4 の値ではない。** 既存の 2 つは
「この面はどのバッファへ行くか」＝**材質**の問いに答える。この 1 つは
「そもそも立方体か」＝**形状**の問いに答える。両方が同時に成り立つのが普通の場合
（見通せる十字板）なので、畳めば片方の答えが失われる。

`crossPlantBlockIds` は**省略可能**にしてある。十字板が存在する前に書かれた config が
そのまま型検査を通り、そのときと**厳密に同じ挙動**になる —— 「どの id も植物ではない」は
そうした config が意味していたことそのものである。

平坦化した 256 バイト表（`buildCrossPlantLookup`）を作るのは `buildLayerLookup` と同じ理由である。
**`buildLayerLookup` に畳まなかった**のは、あの表に `MeshLayer` でない第 4 の値を入れると
その契約（`layerOfBlockId` が `MeshLayer` を返し、`test/public-api.test.ts` が全 256 id で
両者の一致を検査している）が壊れるからで、代わりに払うのは byte index 1 回である。**安いのは読み出しのほうであって契約ではない。**

### 境界検査を**入れて、測って、外した**

`buildCrossPlantLookup` には当初 `if (blockId >= 0 && blockId <= MAX_BLOCK_ID)` があった。
変異テストで**外しても 1 本も落ちなかった**。理由は単純で、`Uint8Array` の範囲外書き込みは
配列自身が仕様どおり黙って捨てるので、**ガードの有無は呼び出し側から区別できない**。到達不能な分岐である。

そこで外した。`domain/lod.ts` が参照実装の退化ガードを移植しなかったのと同じ根拠である ——
到達不能な分岐は永久にカバーできない行であり、どのテストも支持できない主張である。
`test/plant-mesh.test.ts` は範囲外 id の場合を**結果として起きる挙動の記述**として残してある
（ガードを守るテストではない、と明記してある）。

### wall-clock —— ホットパスに 1 回の表引きが増え、8% 払った

`isFaceExposed` は ~40 万 call/chunk の経路であり（plan.md §3.3）、
そこに `isCrossPlant` の byte index が 1 つ増えた。paired 測定（3 対、同一機・同一負荷、
yardstick は両腕で 1.02 倍）:

| workload | 植物配線なし | あり | 比 |
| --- | ---: | ---: | ---: |
| `meshChunk/flat` | 0.859 | 0.927 | **1.08x** |
| `meshChunk/rolling` | 0.998 | 1.076 | **1.08x** |
| `meshChunk/checkerboard-worst` | 0.860 | 0.840 | **0.98x** |
| `meshChunk/layered-water-glass` | 0.886 | 0.962 | **1.09x** |

**checkerboard だけ動かないのが正しい。** あの fixture は半分が空気なので
`blockId === AIR` の短絡で先に抜ける割合が最も高く、追加の表引きに到達する回数が最も少ない。
`Set.has` にしていれば同じ場所で 6.5 倍（`opacity.ts` の値札）を払っていた。

### 移植していないもの（`plant-mesh.ts` 258 LOC のうち）

責務表の行は**十字板**（`植生メッシュ（十字板）`）としか書いていないので、そこで止めた:

| 参照実装の関数 | 行 | 状態 |
| --- | --- | --- |
| `addCrossPlant` | :79-98 | **移植済み** |
| `addLilyPad` | :100-117 | 未移植。薄板 1 枚であって十字ではない |
| `addCactus` | :119-148 | 未移植。inset した立方体であって十字ではない。上下面は隣のサボテンを見て決めるので cull 規則を持つ |
| `addRail` | :165-228 | 未移植。**形状が物理側の `game/domain/rail-shape.ts` を鏡写しにしている**（:163-164 が明言）。あれは別リポジトリの語彙であり、ここで 2 つ目の綴りを作るのは §3.3 が座標について禁じたのと同じ形の誤りになる |
| `getQuadLight` / `sampleVoxelLight` 経由の光 | :51-62 | 未移植。ライトグリッドは mc-worldgen の所有（§3） |

### 回帰テスト

`test/plant-mesh.test.ts`（17 本）:

- `REGRESSION: the two plates run on OPPOSITE diagonals` —— **この項の本体**。
  同じ対角に 2 枚張ると 2 枚は共面になり、**カメラが 90 度回ると植物が消える**。
  そのとき枚数も頂点数もブロック ID も inset も高さも全部正しいままなので、他のどのテストも気づかない。
  頂点列を参照実装から転記した形で固定したうえで、
  **XZ 平面に射影した 2 枚の方向ベクトルの外積が 0 でないこと**を独立に検査する
  （リテラルの表を両方いっぺんに書き換えても、こちらは通らない）
- `is inset horizontally by PLANT_INSET and NOT inset vertically`
- `REGRESSION: a plant emits no cube faces at all` —— ガードが無いと花は立方体としても描かれ、
  立方体が十字を完全に含むので**十字は見えず、花は土のブロックに見える**。
  同じ id を植物集合の無い config で流すと 6 面出ることも検査し、決めているのが**config であって id ではない**ことを固定する
- `REGRESSION: a plant hides nothing` —— 上の逸脱を 6 方向で。
  対照として不透明な隣接では面が減ることも見る（cull を丸ごとやめた実装が通らないように）
- `both meshers agree on the plates, exactly` —— プロパティ。
  `meshChunk` は `solidCeiling`、オラクルは `CHUNK_HEIGHT` で走査するので、
  **走査上限の off-by-one が最上段の花を黙って消す**ならここで落ちる
- `emits in lx, lz, y order` —— **同点を含む** fixture で。
  `lx` を共有する 2 セルが `lx→lz→y` と `lx→y→lz` で逆順になるように置いてある
  （この tie が無いとどちらの nesting でも通る。`test/mesh.test.ts` が自分の順序テストについて
  長く書いている fixture 欠陥と同じ形である）。**最初に書いた期待値はこれで間違いを指摘された**
- `a block can be BOTH a plant and a transparent solid` —— 第 3 の集合である理由

### 落ちることの確認（6 つの変異）

| 変異 | 落ちたテスト |
| --- | --- |
| 2 枚を同じ対角に張る | 1 / 17 |
| inset を Y にも適用する | 3 / 17 |
| **1 つのパス**から植物ガードを外す | 4 / 17 |
| 植物が遮蔽する（参照実装の挙動に戻す） | 1 / 17 |
| `lz` と `y` のループ nesting を入れ替える | 1 / 17 |
| 境界検査を外す | **0 / 17 —— 到達不能と判明。上記のとおりコードのほうを消した** |

---

## M-12 `meshing-fluid-surfaces-are-bilinear-patches`

### 根拠

`responsibility.md` §3 の**最後の保留行**（流体の高さ / 流れ方向）。
保留の理由は AO や十字板とは違っていた —— あの 2 つは「まず基本を固める」であり M-9 で消えたが、
**流体は「入力が無い」であった**（旧 §3.6）。作業量ではなく所有権の問題である。
参照実装の `greedy-meshing-fluids.ts`（205 LOC）+ `greedy-meshing-fluid-state.ts`（181 LOC）の
**ジオメトリの側**を移植した（`domain/fluid-mesh.ts`）。

### 動かしていない線と、引き直した線

責務表の行の但し書き —— 「流体伝播ルール自体は mx-gameplay」—— は**動かしていない。**
`domain/fluid-mesh.ts` に、どのセルにどれだけ流体が来るかを決めるコードは 1 行も無い。
mx-gameplay 側の `domain/fluid-frontier.ts` はそのままである。

**引き直したのは入力の継ぎ目である。** 参照実装は `blocks` とは別に `fluid: Uint8Array` を読み、
5 つのマスク（`packages/block/domain/fluid.ts:7-11`）で復号する。
そのマスクをここで宣言すれば**もう 1 つの綴り**がロスターに増える ——
§3.3（座標）、§3.4（LOD 距離）、M-11（レールの形状）が同じ形で拒否したものである。

旧 §3.6 が挙げていた決着案 (2) は「`ChunkView` の前例にしたがって `fluid?:` を宣言する」だった。
**取ったのは (2) だが、字義どおりではない。** `fluid?: Readonly<Uint8Array>` を宣言しても、
**読むにはマスクが要る**ので誤りをそのまま踏む。そこで継ぎ目を 1 段内側に置いた:

| 所有 | 内容 | 型 |
| --- | --- | --- |
| シミュレーション側 | 流体の有無・種類・**レベル**・**水源か** | `FluidView { levels, sources }` |
| mc-meshing | レベル→水面高、4 隅の平均、露出規則、側面の形 | `domain/fluid-mesh.ts` |

バイト配置の合意が 1 つも要らないので、**マスクはここに 1 つも無い。**
present と kind は `blocks` と `fluidMaxLevels` が既に答えているので冗長であり
（参照実装は両方を持つので突き合わせが要る、`greedy-meshing-fluid-state.ts:63`）、
`maxLevel` はセルごとではなく流体ごとの**伝播の性質**なので `MeshConfig.fluidMaxLevels` で注入する。

### 流体面は `Quad` になれない。そしてそれがマージの答えでもある

十字板（M-11）と同じ結論に、**別の理由で**着く:

| | `Quad` | 十字板 | 流体面 |
| --- | --- | --- | --- |
| 平面 | 軸に平行 | **対角** | 軸に平行（ここは `Quad` と同じ） |
| 座標 | 整数 | 小数 | **4 隅の Y が別々の小数** |
| 被覆するブロック面 | 1 枚以上 | 0 枚 | **0 枚** |
| マージ | する | できない | **できない** |

流体の上面は矩形ではなく**双一次パッチ**であり、その 4 隅の傾きこそが**流れ方向**である。
平らな隅は静水、傾いた隅は流れている水 —— **流れベクトルという値は参照実装にも本実装にも無い。**

**マージが「できない」のであって「高い」のではない。** N セルをまとめた走りは辺ごとに
**N+1 個**の隅の高さを持ち、`Quad` には両端の 2 つぶんしか場所が無い。
中間の高さに置き場が無いので、まとめれば**傾きそのものを捨てる**ことになる。
これは M-10 が**頂点ごとの** AO について述べた論法と同一である
（「16x1 の走りには角が 4 つではなく 17 個ある」）。
参照実装も同意している —— `meshFluidFaces` は `addQuad` に幅・高さを `1, 1` で固定して渡す
（`greedy-meshing-fluids.ts:56-57`）。

したがって `MeshLayers` に **5 つ目**のリスト `fluids` が生えた。
`crossPlants` で 4 つ目を通してあるので、形としては新しくない。
`totalQuadArea` / `totalQuadCount` は流体面を**数えない** —— 高さ 0.875 の面はブロック面を 1 枚も覆わないので、
数えればマージの保存則が**水たまり 1 つで破れているように読める。**

### 被覆同値性（M-9）—— 形のまま生きている

`meshing-merge-covers-the-same-surface` は `meshChunk` と `meshChunkNaive` を比べる主張であり、
**マージについての主張であって、どんな形が存在するかについての主張ではない。**
両メッシャが同じように流体 ID を 6 パスから除外するので（十字板とまったく同じ扱い）、
両者は**同じブロック面の集合**を見ている。よって「同じ面を覆う」の意味は変わっていない。

壊れる書き方は 1 つだけあり、それは**片方のメッシャだけ**流体を除外することである。
`test/fluid-mesh.test.ts` の `REGRESSION: the coverage property still holds when fluids are configured`
が流体入りのチャンクで同じ性質を張り直しているのはそのためである。

### なぜ opt-in なのか —— 立方体の面が**消える**から

流体 ID を宣言すると、そのブロックは 6 パスから外れる。外さなければ湖が**二重に描かれる**
（`y+1` に平らな面、`y+0.875` にパッチ）ので必須だが、
**宣言した瞬間に既存の quad 数が変わる**という副作用がある。

そこで `fluidMaxLevels` は**省略可能**であり、省略は「どの ID も流体ではない」を意味する。
M-11 が `crossPlantBlockIds` に与えたのと同じ互換性だが、**利害はこちらのほうが大きい。**
おかげで:

- 既存テスト 164 本は**1 本も書き換えていない**（`test/lod.test.ts` の 2 箇所に
  `fluids: []` を足したのは型リテラルの補完であって、主張の変更ではない）
- M-9 / M-10 の `layered-water-glass` の数字は**そのまま有効**である。
  あの fixture は流体を宣言していないので、水はいまも立方体である

### 何が動いたか —— 流体は quad を**増やす**。それは削減の失敗ではない

新しい fixture `lake`（`scripts/bench-fixtures.ts`。y=40-55 の傾いた湖底の上に水、
水面のレベルは `lx` で段になる）を**同じバイト列に 2 つの config を当てて**測った:

| lake の描き方 | ブロック面の quad | 被覆面積 | 流体面 |
| --- | ---: | ---: | ---: |
| 流体として（`FLUID_CONFIG`） | **413** | 3,840 | **1,056**（上面 256 + 側面 800） |
| 立方体として（`CONFIG`） | **448**（石 413 + 水 35） | 4,656 | 0 |

読み方を間違えないように 3 つ書いておく:

1. **石の部分は両方とも 413 で完全に一致している。** 差の 35 は水ぶんだけであり、
   被覆面積の差 816（4,656 - 3,840）は素朴実装での水の面数と**厳密に一致する**。検算になっている。
2. **描画プリミティブは 35 → 1,056、つまり 30 倍に増える。**
   マージ済みの平らな水面 35 枚が、マージできない 1x1 のパッチ 1,056 枚になる。
   **これは削減の失敗ではなく、可変高の水面の定価である** —— 段のある水面を段のまま描くことと、
   矩形にまとめることは、両立しない。
3. したがって**流体を宣言するかどうかは mc-render の描画予算の判断である。**
   遠景のチャンクで水を立方体のまま描く（＝`fluidMaxLevels` を渡さない）のは、
   このライブラリが取れる正当な選択肢として残してある。

**時間の側も同じ倍率ではない。** baseline に**対で**入れてあるので比が直接読める
（同一のバイト列に config を 2 つ当てているので、chunk の中身は完全に同じである）:

| workload | 中央値（10 回通し） | 比 |
| --- | ---: | ---: |
| `meshChunk/lake-as-cubes` | 6.080 | — |
| `meshChunk/lake-fluid` | 11.677 | **1.92x** |

**ほぼ全部が水のチャンクで 1.92 倍。** quad が 30 倍になったのに時間が 1.92 倍で済むのは、
費用の出どころが違うからである —— 増えているのは**出力の枚数**であって走査量ではなく、
流体側の走査は「セルごとに 4 隅 × 最大 4 列」という固定の仕事である。
**この 1.92 倍は水だらけのチャンクの上限に近い値**であって、
通常の地形（水が数%）でこの倍率になることはない。

### wall-clock —— 流体を宣言しない config への課金は**雑音の中にある**

流体が無い config でも払うものが 2 つある: `isFluidBlock` の表引きが
`isFaceExposed` の手前のガードに 1 つ増えること（~40 万 call/chunk の経路。plan.md §3.3）と、
`meshFluidSurfaces` の呼び出しそのものである。

**2 つ目は早期脱出で潰した。** `meshFluidSurfaces` は 256 バイトの表を舐めて
流体が 1 つも宣言されていなければ即座に戻る。これが無いと、流体を宣言していない config が
**16 x yLimit x 16 セルの走査をまるごと**払う（`flat` で 16,384 セル）。
表 256 バイト対セル 16,384 なので、この取引は接戦ですらない。

**1 つ目は測った。** interleaved paired 測定（5 対、同一機・同一負荷、
腕 A = shipped、腕 C = 機能導入前＝ガード無し・流体パス呼び出し無し）:

| workload | C 導入前 | A shipped | A/C | C ばらつき | A ばらつき |
| --- | ---: | ---: | ---: | ---: | ---: |
| `meshChunk/flat` | 6.020 | 6.477 | **1.076** | 10.5% | 10.9% |
| `meshChunk/rolling` | 7.103 | 7.332 | **1.032** | 7.6% | 10.3% |
| `meshChunk/checkerboard-worst` | 5.579 | 5.581 | **1.000** | 8.1% | 8.1% |
| `meshChunk/layered-water-glass` | 6.354 | 6.762 | **1.064** | 7.2% | 6.8% |
| `meshChunkNaive/flat` | 11.609 | 11.800 | **1.016** | 8.8% | 5.5% |
| `meshChunkNaive/rolling` | 11.901 | 12.375 | **1.040** | 6.3% | 5.7% |
| `meshChunkNaive/checkerboard-worst` | 11.772 | 11.533 | **0.980** | 6.7% | 6.1% |
| `meshChunkNaive/layered-water-glass` | 11.854 | 12.232 | **1.032** | 8.6% | 10.3% |

**この表の結論は「1.0-1.08 倍」ではなく「分離できていない」である。**
観測された差（0-7.6%）は各腕自身のばらつき（5.5-10.9%）と同じ桁であり、
`meshChunkNaive/checkerboard-worst` に至っては 0.98 と**符号が逆**である。
M-11 が植物の表引きについて 1.08 倍を報告できたのは、そのときの対測定が
そこまで雑音に埋もれていなかったからであって、ここで同じ強さの主張はできない。
**言えるのは「1.1 倍を超える課金は観測されていない」までである。**

なお `checkerboard-worst` がぴったり 1.000 なのは機構的で、M-11 が植物の表引きについて
記録したのと**同じ理由**である —— あの fixture は半分が空気なので `blockId === AIR` の
短絡で先に抜ける割合が最も高く、追加の表引きに到達する回数が最も少ない。
2 つの機能が同じ場所で同じ挙動を示したことは、測定が機構を捉えている弱い証拠にはなる。

### 定数と規則の出典

| 値 / 規則 | 出典 | 状態 |
| --- | --- | --- |
| 水源の水面高 `14/16` | `greedy-meshing-fluid-state.ts:37` | **出典あり**（同 :32-36 に理由。岸辺がガラス壁に見えないため） |
| セルの高さ `max(1/(maxLevel+1), 1 - level/(maxLevel+1))` | 同 :39-43 | 出典あり |
| `maxLevel` = 水 7 / 溶岩 3 | `block/domain/fluid-model.ts:15-16` | 出典あり。**ここでは宣言せず注入する** |
| 隅の高さ = 周囲 2x2 列の平均 | 同 :89-113 | 出典あり |
| 同種流体が上にあれば高さ 1（水没セル） | 同 :74-87 | 出典あり |
| 遮蔽物は「真に不透明なもの」だけ（水槽が見える） | 同 :129-134 | 出典あり |
| 側面の下端 = 隣接流体の水面 | `greedy-meshing-fluids.ts:94-97` | 出典あり |
| 隣接が同高以上なら側面を出さない | 同 :97 | 出典あり |
| 上に流体があれば上面を出さない（種類を問わず） | 同 :69-70 | 出典あり |
| 流体面は AO を持たない（`ZERO_AO`） | 同 :13, 52 | 出典あり |
| 走査順 `lx → y → lz` | 同 :61-63 | 出典あり |
| 幅・高さを `1, 1` に固定＝マージしない | 同 :56-57 | 出典あり |
| **上面 + 側面 4 枚のみ。下面が無いこと** | 同 :70, 92, 120, 148, 176 | **転記のみ。正当化されていない** |
| 非源のレベル 0 が水源より**高い**こと | 同 :37 と :39-43 の帰結 | **転記のみ。参照実装は言及していない** |

**転記のみの 2 行を曖昧にしない。**

- **下面が無い。** 参照実装の流体パスに `yNeg` の場合分けは存在しない。
  帰結として**湖の裏側は描かれず、下から泳いで見上げると水面が透ける。**
  参照実装のどこにもそう書かれておらず、テストも無い。
  ここで下面を足すのは「参照実装は仕様である。作り直すな」（plan.md §8）が警告している種類の追加なので、
  **足さずに、落ちるテストとして記録した**（`test/fluid-mesh.test.ts` の
  `an isolated cell emits a top and four sides — five faces, never six`）。
- **非源のレベル 0 は高さ 1、水源は 14/16。** つまり**流れている水のほうが源より高く描かれる。**
  水（`maxLevel` 7）ではレベル 1 が `1 - 1/8 = 14/16` でちょうど源に一致するので見えないが、
  溶岩（`maxLevel` 3）では 1/8 セルの実際の段差になる。参照実装はこれに触れていない。

### 参照実装からの意図的な逸脱（2 点）

**(1) チャンク境界を跨いで読む。** 参照実装の `resolveFluidState` はチャンク外に対して null を返す
（`greedy-meshing-fluid-state.ts:52-54`）。したがって参照実装では、
**湖の中に 16 ブロックごとに水の壁が立つ**（両軸で）。ここでは `ChunkNeighbours` を辿って
隣接チャンクの `FluidView` を読む。**M-10 が AO について同じ逸脱を行って記録済み**であり、
これは新しい判断ではなくその適用である。

ただし**対角の隣接には届かない。** `ChunkNeighbours` は 4 つで、角を持たない。
よってチャンクの 4 隅の列では隅の平均が 4 サンプルではなく 3 サンプルになる。
これは `getBlockAcrossBoundary` が既に持っている制限と**同一**なので、新しい歪みではない。

**(2) 十字板は流体面を遮蔽しない。** 参照実装の `isFluidFaceOccluder` に植物の概念は無い。
M-11 が「セルの 10 分の 1 を占める 2 枚の対角パネルは何も遮蔽できない」と決めているので、
そちらに揃えた。**新しい判断ではなく、既存の判断を一貫させたものである。**

### 回帰テスト

`test/fluid-mesh.test.ts`（30 本）。載せる価値のあるものだけ:

- `REGRESSION: the surface TILTS toward the emptier neighbour` —— **この項の本体**。
  隅の平均をセル自身の高さに置き換えると、quad は全部出るし順序も巻き方もブロック ID も正しいまま、
  **世界中の湖が階段状の縁を持つ平板になる。** 参照実装から転記した頂点 Y を固定したうえで、
  **+X 側の 2 隅が -X 側より低いこと**を独立に検査する（両方のリテラルを同時に書き換えても通らない）
- `a non-source cell drops one step per level, sized by the INJECTED max level` ——
  水（段 1/8）と溶岩（段 1/4）を**別の値で**検査する。`maxLevel` を定数に戻した実装はここで落ちる
- `REGRESSION: a fluid block emits no cube faces at all` —— 二重描画の防止。
  同じ ID を流体表の無い config で流すと 6 面出ることも検査し、
  決めているのが**config であって ID ではない**ことを固定する
- `an absent fluid table changes nothing whatsoever` —— 互換性の主張そのもの。
  `toStrictEqual` で出力全体を突き合わせる
- `REGRESSION: a lake continuing into the neighbour grows no wall at the seam` ——
  **4 辺すべてで。** 最初の版は `xPos` しか見ておらず、`heightAcross` の 4 本の分岐のうち
  **1 本だけを潰す変異が生き残った。** 残り 3 辺は一度も実行されていなかった
- `REGRESSION: a skirt starts at the NEIGHBOUR's surface, not at the floor` ——
  床から立ち上げても**面数は同じ**なので、数えるテストでは見えない
- `REGRESSION: the coverage property still holds when fluids are configured` —— M-9 の張り直し
- `REGRESSION: no two fluid quads are identical, and none merges` ——
  重複被覆（z-fighting）と、1 セルを超える quad が出ていないことの両方
- `the cell is always one of its own corner samples, so no corner is ever NaN` ——
  `cornerHeight` にゼロ除算のガードが**無い**ことの根拠。チャンクの 4 隅で確認する

### 到達不能なガードを**入れて、測って、外した**（このリポジトリで 3 度目）

`heightIn` には当初 `if (y < 0 || y >= CHUNK_HEIGHT) return NO_FLUID` があった。
**カバレッジがその 2 行を恒久的に未到達と表示した。** 理由は単純で、`getBlock` が
チャンク外に対して既に `AIR` を返しており、`wantId` は流体 ID なので決して `AIR` ではない ——
つまり直後の比較が out-of-range を単独で正しく処理している。

そこで外した。`buildCrossPlantLookup` が境界検査を外したのと（M-11）、
`domain/lod.ts` が参照実装の退化ガードを移植しなかったのと**同じ根拠**である。
外した結果 `domain/fluid-mesh.ts` の行カバレッジは 100% になった。
呼び出し側はこれに依存している —— `surfaceHeightOfColumn` は `y + 1` を見るので、
世界の最上段の流体では `CHUNK_HEIGHT` が渡る。
`test/fluid-mesh.test.ts` の `fluid on the world's TOP ROW still shows a surface` が
**ガードではなく結果として起きる挙動**を固定している
（同時に `solidCeiling` の off-by-one も張っている。他のテストは全部 y=64 付近なので、
これが無いと最上段を黙って消す実装が全部 green で通る）。

### 落ちることの確認（17 の変異、すべて赤）

| 変異 | 落ちたテスト |
| --- | --- |
| 水源高を `14/16` から 1 へ | 4 / 30 |
| 隅の平均をセル自身の高さに置換（平らな水面） | 4 / 30 |
| 水没セルの「上に流体なら 1」を外す | 1 / 30 |
| 高さの下限（`max`）を外す | 1 / 30 |
| `maxLevel` を注入値でなく 7 固定に | 2 / 30 |
| 流体が流体を遮蔽する | 1 / 30 |
| 十字板が流体を遮蔽する | 1 / 30 |
| 側面を床から立ち上げる | 1 / 30 |
| 隣接が同高以上でも側面を出す | 3 / 30 |
| 上に流体があっても上面を出す | 2 / 30 |
| **1 つの**立方体パスから流体ガードを外す | 3 / 30 |
| ループ入れ子 `y` と `lz` を入れ替える | 1 / 30 |
| 境界読みを潰す —— `xNeg` だけ | 2 / 30 |
| 境界読みを潰す —— `xPos` だけ | 2 / 30 |
| 境界読みを潰す —— `zNeg` だけ | 2 / 30 |
| 境界読みを潰す —— `zPos` だけ | 2 / 30 |
| 早期脱出を常に取る（＝流体パスが 1 度も走らない） | **19 / 30** |

**最後から 5 行目までの 4 行は、最初から 4 行だったわけではない。** 当初は境界の変異が
1 つだけ生き残り（`xNeg` を潰しても **0 / 30**）、原因はテストが `xPos` しか張っていなかったことだった。
テストを 4 辺に広げてから 4 本とも赤になった。**変異が見つけた穴であって、変異が確認した安全ではない。**

最終行の 19 / 30 は性能最適化のガードだが、意味も持っている ——
早期脱出の条件を間違えれば**流体機能そのものが黙って無効になる**ので、
「速いほうの分岐が正しいことをテストが知っている」ことの確認になっている。

### 移植していないもの（385 LOC のうち）

| 参照実装 | 行 | 状態 |
| --- | --- | --- |
| `decodeFaceLighting` / `sampleCornerLight` 経由の光 | state:159-180 | 未移植。ライトグリッドは mc-worldgen の所有（§3） |
| `isSolidFaceExposed` | state:145-157 | 未移植。**立方体パスの規則**であり `domain/mesh.ts` が自前のものを持つ。次項 |
| `decodeFluidByte` と 5 つのマスク | `block/domain/fluid.ts:7-30` | 未移植。符号化は所有者のもの |
| accumulator 振り分け `transparentLookup ? water : opaque` | fluids:43 | 未移植。「どのバッファか」は `domain/opacity.ts` が既に答えている |

**`isSolidFaceExposed` を移植しなかったことには帰結がある。** 参照実装のそれは
空気か transparent-solid の隣接でしか固体面を露出させないので、
**水中の石はそこでは面を 1 枚も持たない**（＝湖底が描かれない）。
`domain/mesh.ts` は最初から自前のレイヤ規則を使っており、水中の石の面は出る。
この行は**流体のジオメトリ**についてのものであって固体の露出規則を決め直すものではないので、
**触らなかった。** `test/fluid-mesh.test.ts` の
`a solid block beside water still shows its face — the lake bed renders` が
流体側からもその差を見えるようにしてある。

---

## 参照実装の数値の訂正

| plan.md | 実測 |
| --- | --- |
| meshing 3 ファイルで 3,994 LOC | 名指しの 3 ファイルは **343**。メッシングモジュール全体（23 ファイル）で **3,830**。詳細は `porting.md` |

`transparentBlockIds` がネイティブ `Set` であるという記述は**正しい**（M-1 で検証）。
