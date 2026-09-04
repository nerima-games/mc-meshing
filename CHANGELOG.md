# @nerima-games/mc-meshing

## 0.2.0

### Minor Changes

- [#17](https://github.com/nerima-games/mc-meshing/pull/17) [`76020a7`](https://github.com/nerima-games/mc-meshing/commit/76020a7b703acdd7b6e2f7caa6ab9241caee658c) Thanks [@takeokunn](https://github.com/takeokunn)! - Widened `ChunkView.blocks` from one byte per block (`Uint8Array`, ceiling 255) to two bytes per block (`Uint16Array`, ceiling `MAX_BLOCK_ID` = 65535), matching `@nerima-games/mc-kernel`'s own `BlockState`/`BLOCK_ID_MAX` width. The registry currently tops out at id 122 (kernel 0.7.0), so nothing was truncating yet — this closes the gap before it could, completing what `kernel-0-7-0-pin.md` (0.1.x) deliberately deferred: that changeset decoupled `MAX_BLOCK_ID` from the kernel's own growing ceiling specifically because this package's storage was still one byte wide, and said so. `MAX_BLOCK_ID` now re-exports the kernel's `BLOCK_ID_MAX` directly rather than restating it as a local literal, so the two constants cannot drift apart again the way they already had once.
  
  `domain/chunk-view.ts`'s `ChunkView.blocks`, `emptyChunk`, `getBlock`/`getBlockAcrossBoundary`, `domain/block-data.ts`'s `blockIdAt`, and `domain/mesh-support.ts`'s `solidCeiling` all changed their block-buffer parameter or field type to `Uint16Array`. Every byte-indexed lookup table keyed BY block id (`buildLayerLookup`, `buildCrossPlantLookup`, `SPECIAL_BLOCK_LOOKUP`, `buildFluidLookup`) grows to `MAX_BLOCK_ID + 1` entries automatically, since all of them were already sized from the constant rather than a literal `256`; their VALUES stay small enumerated codes, so they remain `Uint8Array`/`Uint16Array` as before — only their length changed. Light grids (`LightView.blockLight`/`skyLight`), fluid state (`FluidView.levels`/`sources`/`falling`), and `RailShapeView` are deliberately untouched: those are genuinely one byte per cell and have nothing to do with block ids.
  
  The greedy mesher's face mask needed more than a type change. `mesh-greedy.ts` packs `blockId | (ao << AO_SHIFT)` into one integer per cell and merges only while that whole integer repeats; `AO_SHIFT` was 8, immediately above the old byte-wide id range. With ids now up to 16 bits, `AO_SHIFT` moves to 16 and the packed value can need up to 18 bits, so `GreedyMasks.mask` (and every buffer that backs it — `MeshWorkBuffers` in `domain/mesh.ts`, `MeshScratchBuffers`/`MeshScratch` in `domain/mesh-scratch.ts`) widened from `Uint16Array` to `Uint32Array`. Getting only the storage type right and leaving this packing at the old shift would have reintroduced the exact corruption `kernel-0-7-0-pin.md` fixed once already, just at a wider boundary: any block id above `0x3fff` would have collided with the AO bits it merges on.
  
  The packed GPU-ready output also carried block ids narrowly: `domain/mesh-buffers.ts`'s `PackedMeshBuffers.blockIds` was a `Uint8Array` per-vertex attribute and is now `Uint16Array`. This is this package's own output contract, not another package's concern — a consumer reading `blockIds` as bytes will now see the correct wider values instead of a silent truncation.
  
  No persisted or wire format exists in this package to migrate. `ChunkView` is purely in-memory — the caller copies opaque kernel block storage into it at the boundary (`domain/chunk-view.ts`'s header comment) and this package never serializes a chunk itself — so this change has no save-compatibility surface and needs no version bump or migration path, unlike the analogous change in `@nerima-games/mc-worldgen` (0.4.0), which does own a persisted chunk format.
  
  Two regression tests round-trip ids byte storage cannot hold: `test/mesh.test.ts`'s existing AO/merge regression now uses `MAX_BLOCK_ID` (65535) instead of the old byte ceiling 255, so it is a round-trip test for the wider storage as well as for the AO packing; a new test meshes an isolated block at id 300 — which a `Uint8Array` could only ever have stored as 44 — and asserts the emitted quads report `blockId === 300`, never `44`. `test/plant-mesh.test.ts`'s lookup-table-size and out-of-range assertions moved from the literal `256`/`255` to `MAX_BLOCK_ID + 1`/`MAX_BLOCK_ID`, since a hardcoded `256` had gone from "the whole domain" to "an arbitrary interior value" and would no longer have caught a real regression.
  
  `typecheck`, `lint`, `test` (225/225), `test:coverage` (100% statements/branches/functions/lines), `build`, and `package:verify` all pass.

## 0.1.6

### Patch Changes

- [`0c82d5a`](https://github.com/nerima-games/mc-meshing/commit/0c82d5ad5df25bcc611d0b7b5c2fdd0701580410) Thanks [@takeokunn](https://github.com/takeokunn)! - Pin `@nerima-games/mc-kernel` to `0.7.0` (from `0.4.0`).
  
  The registry properties this package reads for face culling and greedy
  meshing — opacity, render kind, and collision shape — are unchanged for every
  currently-registered block, so mesh output is unaffected by the block-data
  side of the bump.
  
  The one real hazard was `BLOCK_ID_MAX`: the kernel widened it from `255` to
  `0xffff` when its own `Chunk` wire format grew a 16-bit element (mc-kernel
  0.5.0). This package re-exported that constant as its own `MAX_BLOCK_ID` and
  used it both to size several byte-indexed lookup tables and, in the greedy
  mesher, to mask a packed `blockId | (ao << 8)` cell back apart. The mask
  silently widening past one byte meant a merged quad's reported `blockId`
  picked up its ambient-occlusion bits whenever `ao` was non-zero — a real
  geometry-affecting corruption caught by the existing id-255 AO regression
  test. `MAX_BLOCK_ID` now reflects this package's own storage boundary — the
  `Uint8Array` `ChunkView.blocks` always was and remains one byte per cell,
  independent of the kernel's wire format — so its value is unchanged from
  before the bump (`0xff`) and every existing geometry assertion still holds.

- [#14](https://github.com/nerima-games/mc-meshing/pull/14) [`9dd4921`](https://github.com/nerima-games/mc-meshing/commit/9dd4921a0ad6e0712b55602372e4a2afe900fbfc) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.1.5

### Patch Changes

- [#11](https://github.com/nerima-games/mc-meshing/pull/11) [`bdc164c`](https://github.com/nerima-games/mc-meshing/commit/bdc164cabfd30086dd73f3b6f80242e2c0582555) Thanks [@takeokunn](https://github.com/takeokunn)! - Land the local main: chunk view on kernel coordinates and package verification.

- [#8](https://github.com/nerima-games/mc-meshing/pull/8) [`b1e1f59`](https://github.com/nerima-games/mc-meshing/commit/b1e1f593c8707bf8ea7b2cdbc343a3fc19d57a0a) Thanks [@takeokunn](https://github.com/takeokunn)! - Scope lint strictness to production sources and fix real violations across the meshing domain, scripts, and tests.

- [#12](https://github.com/nerima-games/mc-meshing/pull/12) [`20a9654`](https://github.com/nerima-games/mc-meshing/commit/20a9654dc3126e04114c78c55c4b392821c9f6f5) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added

## 0.1.2

### Patch Changes

- Restrict greedy rectangle merging to opaque cube faces. Transparent solids,
  fluids, and plants retain deterministic unit primitives while preserving the
  existing geometry, AO, chunk-boundary, and subregion-halo contracts.

- [#1](https://github.com/nerima-games/mc-meshing/pull/1) [`0fd6a6d`](https://github.com/nerima-games/mc-meshing/commit/0fd6a6db6a71dfdb4a49c4672b583c8f3a61151a) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate repository layout and tooling to the nerima-games org standard: move
  distributed source under `src/`, drop the bespoke `api-lock` and
  `check-dependency-whitelist` mechanisms in favor of human review
  (API_STANDARD.md) and `.oxlintrc.json`'s `no-restricted-imports`
  (DEPENDENCY_POLICY.md), SHA-pin GitHub Actions, add Dependabot, enable the
  4-metric 99% coverage gate, and adopt changesets for versioning. No runtime
  behavior or public API surface changes.
