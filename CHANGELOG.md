# @nerima-games/mc-meshing

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
