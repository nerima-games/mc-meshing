---
"@nerima-games/mc-meshing": patch
---

Migrate repository layout and tooling to the nerima-games org standard: move
distributed source under `src/`, drop the bespoke `api-lock` and
`check-dependency-whitelist` mechanisms in favor of human review
(API_STANDARD.md) and `.oxlintrc.json`'s `no-restricted-imports`
(DEPENDENCY_POLICY.md), SHA-pin GitHub Actions, add Dependabot, enable the
4-metric 99% coverage gate, and adopt changesets for versioning. No runtime
behavior or public API surface changes.
