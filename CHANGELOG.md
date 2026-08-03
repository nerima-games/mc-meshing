# @nerima-games/mc-meshing

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
