import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const packageDirectory = await mkdtemp(join(tmpdir(), 'mc-meshing-package-'))
let extractionDirectory = null

try {
  await execFileAsync(
    'pnpm',
    ['pack', '--pack-destination', packageDirectory],
    { cwd: process.cwd() },
  )

  const archives = (await readdir(packageDirectory)).filter((name) => name.endsWith('.tgz'))
  if (archives.length !== 1) {
    throw new Error(`expected one package archive, found ${archives.length}`)
  }

  const archive = join(packageDirectory, archives[0])
  if ((await stat(archive)).size === 0) {
    throw new Error('package archive is empty')
  }

  const { stdout } = await execFileAsync('tar', ['-tzf', archive])
  const entries = new Set(stdout.trim().split(/\r?\n/))
  for (const required of [
    'package/package.json',
    'package/README.md',
    'package/dist/index.js',
    'package/dist/index.d.ts',
  ]) {
    if (!entries.has(required)) {
      throw new Error(`package archive is missing ${required}`)
    }
  }

  for (const entry of entries) {
    if (entry.startsWith('package/src/') || entry.startsWith('package/test/')) {
      throw new Error(`package archive contains development source: ${entry}`)
    }
  }

  extractionDirectory = await mkdtemp(join(process.cwd(), '.package-verify-'))
  await execFileAsync('tar', ['-xzf', archive, '-C', extractionDirectory])

  const api = await import(
    pathToFileURL(join(extractionDirectory, 'package', 'dist', 'index.js')).href,
  )
  if (typeof api.meshChunk !== 'function') {
    throw new Error('packed package smoke test could not load meshChunk')
  }

  console.log(`package verification passed: ${archives[0]}`)
} finally {
  await rm(packageDirectory, { recursive: true, force: true })
  if (extractionDirectory !== null) {
    await rm(extractionDirectory, { recursive: true, force: true })
  }
}
