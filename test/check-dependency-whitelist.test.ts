/**
 * The dependency gate, tested as code rather than trusted as configuration.
 *
 * `scripts/check-dependency-whitelist.ts` is the only thing standing between a
 * 16-repository architecture and a monolith with 16 folders. It is copied by
 * hand into every repository, so it needs its own tests in every repository:
 * a gate that has silently stopped gating looks exactly like a gate that passes.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  DEV_ONLY_PACKAGES,
  extractOrgPackageName,
  findBannedTimeSources,
  findCycles,
  findTransitivePath,
  isToolingOrTestPath,
  KERNEL_PACKAGE,
  maskSource,
  parseImports,
  REPOSITORY_POLICY,
  type DeclaredDependencies,
} from '../scripts/check-dependency-whitelist'

const THIS_PACKAGE = '@nerima-games/mc-meshing'

const NOTHING_DECLARED: DeclaredDependencies = {
  dependencies: new Set<string>(),
  devDependencies: new Set<string>(),
}

const graph = (entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Map<string, ReadonlySet<string>> =>
  new Map(entries.map(([node, targets]) => [node, new Set(targets)]))

describe('mc-meshing dependency policy', () => {
  it.effect('declares no direct dependencies: mc-meshing is a tier-1 library and needs only the kernel vocabulary', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.thisPackage).toBe(THIS_PACKAGE)
      expect([...allowedDirectDependencies()]).toStrictEqual([])
    }),
  )

  it.effect('has an internally consistent configuration, so the gate itself cannot be quietly broken', () =>
    Effect.sync(() => {
      expect(checkPolicyConfiguration()).toStrictEqual([])
    }),
  )
})

describe('the recorded 16-repository roster', () => {
  const ROSTER: ReadonlyArray<string> = [
    'mc-kernel',
    'mc-noise',
    'mc-meshing',
    'mc-physics',
    'mc-save',
    'mc-audio',
    'mc-worldgen',
    'mc-sim',
    'mc-render',
    'mc-playground-kit',
    'mx-gameplay',
    'mx-redstone',
    'mx-ui',
    'mx-multiplayer',
    'mc-compose',
    'mc-dev-meta',
  ].map((name) => `@nerima-games/${name}`)

  it.effect('records all sixteen repositories, so an import of any sibling gets a real answer', () =>
    Effect.sync(() => {
      // Before the roster was complete, an import of an unlisted package failed
      // as `unknown-package` — safe, but indistinguishable from a typo. With
      // every row present the gate can tell "not allowed" from "does not exist".
      expect([...REPOSITORY_POLICY.dependencyGraph.keys()].sort()).toStrictEqual([...ROSTER].sort())
    }),
  )

  it.effect('never names mc-kernel as a target: kernel is universal, and a row for it would fail the gate', () =>
    Effect.sync(() => {
      // Note: kernel appears as a KEY (its own row, with an empty target set).
      // What must never happen is kernel appearing as a TARGET of any row.
      for (const targets of REPOSITORY_POLICY.dependencyGraph.values()) {
        expect([...targets]).not.toContain(KERNEL_PACKAGE)
      }
      expect([...(REPOSITORY_POLICY.dependencyGraph.get(KERNEL_PACKAGE) ?? [])]).toStrictEqual([])
    }),
  )

  it.effect('is acyclic — the whole architecture, not just this repository row', () =>
    Effect.sync(() => {
      expect(findCycles(REPOSITORY_POLICY.dependencyGraph)).toStrictEqual([])
    }),
  )

  it.effect('has no edges between experience modules, which is plan.md 2.3-1 as an assertion', () =>
    Effect.sync(() => {
      const experience = ROSTER.filter((name) => name.includes('/mx-'))
      for (const module of experience) {
        const targets = REPOSITORY_POLICY.dependencyGraph.get(module) ?? new Set<string>()
        for (const target of targets) {
          expect(experience).not.toContain(target)
        }
      }
    }),
  )

  it.effect('never lists mc-playground-kit as a runtime target, because it is devDependency-only', () =>
    Effect.sync(() => {
      const kit = '@nerima-games/mc-playground-kit'
      expect(DEV_ONLY_PACKAGES.has(kit)).toBe(true)
      expect(REPOSITORY_POLICY.dependencyGraph.has(kit)).toBe(true)
      for (const targets of REPOSITORY_POLICY.dependencyGraph.values()) {
        expect([...targets]).not.toContain(kit)
      }
    }),
  )

  it.effect('reproduces the graph of plan.md 2.1 edge for edge', () =>
    Effect.sync(() => {
      const expected: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        ['mc-worldgen', ['mc-noise', 'mc-save']],
        ['mc-sim', ['mc-physics', 'mc-save', 'mc-worldgen']],
        ['mc-render', ['mc-meshing', 'mc-sim', 'mc-worldgen']],
        ['mc-playground-kit', ['mc-render', 'mc-sim', 'mc-worldgen']],
        ['mx-gameplay', ['mc-audio', 'mc-sim', 'mc-worldgen']],
        ['mx-redstone', ['mc-sim', 'mc-worldgen']],
        ['mx-ui', ['mc-audio', 'mc-sim']],
        ['mx-multiplayer', ['mc-sim']],
        ['mc-compose', ['mc-render', 'mx-gameplay', 'mx-multiplayer', 'mx-redstone', 'mx-ui']],
      ]
      for (const [node, targets] of expected) {
        const actual = REPOSITORY_POLICY.dependencyGraph.get(`@nerima-games/${node}`) ?? new Set<string>()
        expect([...actual].sort()).toStrictEqual(targets.map((name) => `@nerima-games/${name}`).sort())
      }
    }),
  )
})

describe('cycle rejection', () => {
  it.effect('rejects a two-node cycle outright — there is no co-evolution allowlist in this project', () =>
    Effect.sync(() => {
      const violations = findCycles(graph([['a', ['b']], ['b', ['a']]]))
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]?.rule).toBe('cycle')
    }),
  )

  it.effect('accepts a diamond, because a DAG with a shared descendant is not a cycle', () =>
    Effect.sync(() => {
      expect(findCycles(graph([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]]))).toStrictEqual([])
    }),
  )
})

describe('transitive closure is not an import licence', () => {
  it.effect('explains a transitive import by naming the path, using the real roster', () =>
    Effect.sync(() => {
      // mc-render -> mc-sim -> mc-physics exists in the real graph, and is
      // exactly the shape plan.md forbids reaching through.
      const path = findTransitivePath(
        REPOSITORY_POLICY.dependencyGraph,
        '@nerima-games/mc-render',
        '@nerima-games/mc-physics',
      )
      expect(path).toStrictEqual([
        '@nerima-games/mc-render',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-physics',
      ])
    }),
  )

  it.effect('mx-gameplay may not import mc-physics merely because mc-sim does', () =>
    Effect.sync(() => {
      expect(
        findTransitivePath(
          REPOSITORY_POLICY.dependencyGraph,
          '@nerima-games/mx-gameplay',
          '@nerima-games/mc-physics',
        ),
      ).toStrictEqual([
        '@nerima-games/mx-gameplay',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-physics',
      ])
    }),
  )

  // From THIS repository's seat the transitive-closure branch is unreachable:
  // its own row is empty, so every foreign import is `not-whitelisted` and the
  // most important rule in the gate would otherwise ship untested. `PolicyView`
  // lets the test ask "what would this gate do if it were installed in
  // mx-gameplay?" against the real roster.
  const asPolicy = (thisPackage: string) => ({
    thisPackage,
    dependencyGraph: REPOSITORY_POLICY.dependencyGraph,
    aliases: REPOSITORY_POLICY.aliases,
  })

  const shippedImport = (importedPackage: string) => ({
    importedPackage,
    filePath: 'domain/example.ts',
    line: 1,
    isToolingOrTest: false,
  })

  it.effect('installed in mx-gameplay, the gate reports a transitive import as such and names the path', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        shippedImport('@nerima-games/mc-physics'),
        NOTHING_DECLARED,
        asPolicy('@nerima-games/mx-gameplay'),
      )
      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain('mx-gameplay -> @nerima-games/mc-sim -> @nerima-games/mc-physics')
    }),
  )

  it.effect('installed in mc-render, reaching through mc-sim to mc-physics is equally rejected', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        shippedImport('@nerima-games/mc-physics'),
        NOTHING_DECLARED,
        asPolicy('@nerima-games/mc-render'),
      )
      expect(violation?.rule).toBe('transitive-import')
    }),
  )

  it.effect('installed in mx-gameplay, a genuine DIRECT dependency is allowed once declared', () =>
    Effect.sync(() => {
      const policy = asPolicy('@nerima-games/mx-gameplay')
      // Declared nowhere: allowed by the graph, rejected by the manifest check.
      expect(classifyImport(shippedImport('@nerima-games/mc-sim'), NOTHING_DECLARED, policy)?.rule).toBe(
        'undeclared-dependency',
      )
      // Declared: allowed outright.
      expect(
        classifyImport(
          shippedImport('@nerima-games/mc-sim'),
          { dependencies: new Set(['@nerima-games/mc-sim']), devDependencies: new Set<string>() },
          policy,
        ),
      ).toBeUndefined()
    }),
  )

  it.effect('installed in any experience module, importing a sibling experience module is rejected', () =>
    Effect.sync(() => {
      // plan.md §2.3-1 as an executable assertion, checked from every seat.
      const experience = [
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
        '@nerima-games/mx-multiplayer',
      ]
      for (const seat of experience) {
        for (const target of experience) {
          if (seat === target) {
            continue
          }
          const violation = classifyImport(shippedImport(target), NOTHING_DECLARED, asPolicy(seat))
          expect(violation).toBeDefined()
          expect(violation?.rule).not.toBe('undeclared-dependency')
        }
      }
    }),
  )
})

describe('import classification for this repository', () => {
  const shippedSite = (importedPackage: string) => ({
    importedPackage,
    filePath: 'domain/example.ts',
    line: 1,
    isToolingOrTest: false,
  })

  it.effect('rejects importing any sibling: this repository is allowed the kernel and nothing else', () =>
    Effect.sync(() => {
      for (const sibling of ['mc-sim', 'mc-worldgen', 'mc-render', 'mc-save']) {
        const violation = classifyImport(shippedSite(`@nerima-games/${sibling}`), NOTHING_DECLARED)
        expect(violation?.rule).toBe('not-whitelisted')
      }
    }),
  )

  it.effect('rejects a self-import and tells the author to use a relative path', () =>
    Effect.sync(() => {
      const violation = classifyImport(shippedSite(THIS_PACKAGE), NOTHING_DECLARED)
      expect(violation?.rule).toBe('self-import')
    }),
  )

  it.effect('allows kernel without an allowlist entry, but still requires it in package.json', () =>
    Effect.sync(() => {
      expect(classifyImport(shippedSite(KERNEL_PACKAGE), NOTHING_DECLARED)?.rule).toBe('undeclared-dependency')
      expect(
        classifyImport(shippedSite(KERNEL_PACKAGE), {
          dependencies: new Set([KERNEL_PACKAGE]),
          devDependencies: new Set<string>(),
        }),
      ).toBeUndefined()
    }),
  )

  it.effect('rejects mc-playground-kit from shipped source with the specific, actionable message', () =>
    Effect.sync(() => {
      const violation = classifyImport(shippedSite('@nerima-games/mc-playground-kit'), NOTHING_DECLARED)
      expect(violation?.rule).toBe('dev-only-package-in-shipped-source')
    }),
  )

  it.effect('rejects mc-playground-kit in "dependencies" even when nothing imports it', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies({
        dependencies: new Set(['@nerima-games/mc-playground-kit']),
        devDependencies: new Set<string>(),
      })
      expect(violations.map((violation) => violation.rule)).toStrictEqual(['dev-only-package-in-dependencies'])
    }),
  )

  it.effect('accepts mc-playground-kit in "devDependencies", which is where it belongs', () =>
    Effect.sync(() => {
      expect(
        checkDeclaredDependencies({
          dependencies: new Set<string>(),
          devDependencies: new Set(['@nerima-games/mc-playground-kit']),
        }),
      ).toStrictEqual([])
    }),
  )

  it.effect('treats non-org packages as none of its business', () =>
    Effect.sync(() => {
      expect(extractOrgPackageName('effect')).toBeUndefined()
      expect(extractOrgPackageName('node:fs/promises')).toBeUndefined()
      expect(extractOrgPackageName('@nerima-games/mc-sim/domain/thing')).toBe('@nerima-games/mc-sim')
    }),
  )

  it.effect('knows which paths are shipped and which are tooling', () =>
    Effect.sync(() => {
      expect(isToolingOrTestPath('index.ts')).toBe(false)
      expect(isToolingOrTestPath('domain/field.ts')).toBe(false)
      expect(isToolingOrTestPath('test/x.test.ts')).toBe(true)
      expect(isToolingOrTestPath('scripts/x.ts')).toBe(true)
    }),
  )
})

describe('the time-source ban', () => {
  it.effect('catches all three banned readings', () =>
    Effect.sync(() => {
      const source = ['const a = Date.now()', 'const b = new Date()', 'const c = performance.now()'].join('\n')
      const violations = findBannedTimeSources(source, 'domain/example.ts')
      expect(violations.map((violation) => violation.line)).toStrictEqual([1, 2, 3])
      expect(new Set(violations.map((violation) => violation.rule))).toStrictEqual(new Set(['banned-time-source']))
    }),
  )

  it.effect('does not fire on a comment, a string or a doc example that merely mentions one', () =>
    Effect.sync(() => {
      const source = ['// never write Date.now() here', "const help = 'Date.now() is banned'", '/* new Date() */'].join(
        '\n',
      )
      expect(findBannedTimeSources(source, 'domain/example.ts')).toStrictEqual([])
    }),
  )

  it.effect('honours the escape hatch, which exists for the clock adapter and nothing else', () =>
    Effect.sync(() => {
      const source = 'const now = Date.now() // mc-kernel-allow-time-source'
      expect(findBannedTimeSources(source, 'domain/example.ts')).toStrictEqual([])
    }),
  )
})

describe('import extraction', () => {
  it.effect('sees real imports across all the syntactic forms, including multi-line ones', () =>
    Effect.sync(() => {
      const source = [
        "import { a } from '@nerima-games/mc-sim'",
        "import type { B } from '@nerima-games/mc-save'",
        "export * from '@nerima-games/mc-audio'",
        'const lazy = await import(',
        "  '@nerima-games/mc-render'",
        ')',
        'import {',
        '  c,',
        "} from '@nerima-games/mc-worldgen'",
      ].join('\n')
      const found = parseImports(source).map((record) => record.specifier)
      expect(found).toContain('@nerima-games/mc-sim')
      expect(found).toContain('@nerima-games/mc-save')
      expect(found).toContain('@nerima-games/mc-audio')
      expect(found).toContain('@nerima-games/mc-render')
      expect(found).toContain('@nerima-games/mc-worldgen')
    }),
  )

  it.effect('ignores an import that only appears inside a comment or a string', () =>
    Effect.sync(() => {
      const source = [
        "// import { a } from '@nerima-games/mc-sim'",
        "const doc = \"import { a } from '@nerima-games/mc-render'\"",
      ].join('\n')
      expect(parseImports(source).map((record) => record.specifier)).toStrictEqual([])
    }),
  )

  it.effect('preserves offsets when masking, so reported line numbers are the real ones', () =>
    Effect.sync(() => {
      const source = "const a = 1 // note\nconst b = 'text'\nconst c = 3"
      const masked = maskSource(source)
      expect(masked.length).toBe(source.length)
      expect(masked.split('\n').length).toBe(3)
    }),
  )
})
