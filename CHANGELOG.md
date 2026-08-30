# @nerima-games/mc-meshing

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
