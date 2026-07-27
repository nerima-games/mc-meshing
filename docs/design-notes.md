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

### マージのキーは `blockId` だけであり、それで足りる

同一方向・同一スライス・同一 `blockId` の面がまとまる。要求されている 3 つの禁止事項は
すべてこれで満たされる:

| 禁止事項 | なぜ起きえないか |
| --- | --- |
| レイヤをまたぐ | レイヤは `blockId` の関数（`layerOfBlockId`）。ID が等しければレイヤも等しい |
| ブロック種別をまたぐ | ID そのものがキーである |
| 遮蔽の違う面をまたぐ | 遮蔽はマスクを書く**前に**判定する。隠れている面はマスクに入らず、マスクの零値は `AIR` で、展開は `AIR` を突き抜けない |

`role` は `direction` の関数で、方向ごとに別パスなのでキーに要らない。
参照実装が AO と 4 隅の光を ID と一緒にパックしている（`greedy-meshing-passes.ts:24-45`）のは
**光った quad をマージするから**である。**ライティングが入ったらキーを広げること。**
広げないと、光の違う板が 1 枚にまとまってライティングが目に見えて平坦になる。

### 何を測ったか —— quad 削減は**数え上げ**であって timing ではない

| fixture | 素朴 | マージ後 | 削減 | 被覆面積（両実装で一致） |
| --- | ---: | ---: | ---: | ---: |
| flat | 4,608 | **10** | **-99.8%** | 4,608 |
| rolling | 5,558 | **768** | **-86.2%** | 5,558 |
| checkerboard-worst | 12,288 | **12,288** | **0.0%** | 12,288 |
| layered-water-glass | 5,376 | **17** | **-99.7%** | 5,376 |

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
- `REGRESSION: never merges across the three layers, so one quad is never half water`
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

## 参照実装の数値の訂正

| plan.md | 実測 |
| --- | --- |
| meshing 3 ファイルで 3,994 LOC | 名指しの 3 ファイルは **343**。メッシングモジュール全体（23 ファイル）で **3,830**。詳細は `porting.md` |

`transparentBlockIds` がネイティブ `Set` であるという記述は**正しい**（M-1 で検証）。
