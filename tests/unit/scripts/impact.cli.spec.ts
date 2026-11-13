import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createGitRepository,
  removeTemporaryRepositories,
  runGit,
  runScript,
  writeRepositoryFile,
} from './repoFixture'

const CORE = 'src/shared/lib/core.ts'
const NOTES = 'docs/NOTES.md'
const PARTNER = 'src/app/main/partner.ts'
const SPEC = 'tests/unit/core.spec.ts'
const INDEX = 'scripts/impact-cochange-index.json'

let repository = ''
let shallow = ''

function commit(cwd: string, message: string) {
  runGit(['add', '-A'], cwd)
  runGit(
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', message],
    cwd,
  )
}

function impact(args: string[], cwd = repository) {
  return runScript('impact.mjs', cwd, args)
}

function impactJson(args: string[], cwd = repository) {
  const result = impact([...args, '--json'], cwd)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

beforeAll(() => {
  repository = createGitRepository()
  writeRepositoryFile(repository, CORE, 'export const core = 0\n')
  writeRepositoryFile(repository, 'src/shared/lib/index.ts', "export * from './core'\n")
  writeRepositoryFile(repository, PARTNER, "import { core } from '@shared/lib'\nexport { core }\n")
  writeRepositoryFile(repository, SPEC, "import { core } from '../../src/shared/lib/core'\n")
  writeRepositoryFile(repository, NOTES, 'notes 0\n')
  commit(repository, 'feat: initial')
  for (let round = 1; round <= 7; round += 1) {
    writeRepositoryFile(repository, CORE, `export const core = ${round}\n`)
    writeRepositoryFile(repository, NOTES, `notes ${round}\n`)
    commit(repository, `feat: round ${round}`)
  }
  const index = runScript('impact-index.mjs', repository)
  expect(index.status, index.stderr).toBe(0)
  commit(repository, 'chore: index')

  shallow = join(createGitRepository(), 'clone')
  runGit(['clone', '-q', '--depth', '2', `file://${repository}`, shallow], repository)
})

afterAll(removeTemporaryRepositories)

describe('pnpm impact', () => {
  it('prints a --json report that follows the schema and contains every importer', () => {
    const report = impactJson([CORE, 'src/shared/lib/planned.ts'])

    expect(Object.keys(report)).toEqual([
      'schemaVersion',
      'input',
      'areas',
      'importers',
      'cochange',
      'tests',
      'e2e',
      'limits',
    ])
    expect(report.schemaVersion).toBe(1)
    expect(report.input).toEqual({ mode: 'explicit', files: [CORE, 'src/shared/lib/planned.ts'] })
    expect(report.areas).toEqual([
      { area: 'shared', layers: { shared: 2 }, files: [CORE, 'src/shared/lib/planned.ts'] },
    ])
    expect(Object.keys(report.cochange)).toEqual([
      'source',
      'missing',
      'noHistory',
      'droppedStalePaths',
    ])
    expect(report.cochange.source).toMatchObject({ kind: 'index', stale: false })
    expect(report.cochange.missing).toEqual([
      {
        file: CORE,
        partner: NOTES,
        together: 8,
        fileChanges: 8,
        confidence: 1,
        alwaysTogether: false,
        importLink: null,
      },
    ])
    expect(report.cochange.noHistory).toEqual(['src/shared/lib/planned.ts'])
    expect(report.tests).toEqual([SPEC])
    expect(report.e2e.groups.map((group: { id: string }) => group.id)).toContain('core')
    expect(Array.isArray(report.limits)).toBe(true)

    const { byArea, runtime, typeOnly } = report.importers[CORE]
    expect(runtime).toBe(2)
    expect(typeOnly).toBe(0)
    expect(byArea['app/main']).toEqual([
      { file: PARTNER, kind: 'runtime', via: 'src/shared/lib/index.ts' },
    ])
    expect(byArea.shared).toEqual([{ file: 'src/shared/lib/index.ts', kind: 'runtime' }])
  })

  it('prints the human report with the partner', () => {
    const result = impact([CORE])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Imported by')
    expect(result.stdout).toContain(`${NOTES}  8/8  100%`)
    expect(result.stdout).toContain('Related tests      1 (tests/unit/core.spec.ts)')
  })

  it('works on the staged change and stops listing a partner once it is staged too', () => {
    writeFileSync(join(repository, CORE), 'export const core = 99\n')
    runGit(['add', CORE], repository)
    expect(
      impactJson(['--staged']).cochange.missing.map((m: { partner: string }) => m.partner),
    ).toEqual([NOTES])

    writeFileSync(join(repository, NOTES), 'notes 99\n')
    runGit(['add', NOTES], repository)
    expect(impactJson(['--staged']).cochange.missing).toEqual([])
    runGit(['reset', '-q', '--hard'], repository)
  })

  it('works against a base, including uncommitted and new files', () => {
    writeFileSync(join(repository, CORE), 'export const core = 100\n')
    writeRepositoryFile(repository, 'src/shared/lib/fresh.ts', 'export const fresh = 1\n')
    const report = impactJson(['--base', 'HEAD'])
    expect(report.input).toEqual({
      mode: 'base',
      base: 'HEAD',
      files: [CORE, 'src/shared/lib/fresh.ts'],
    })
    expect(report.cochange.missing.map((m: { partner: string }) => m.partner)).toEqual([NOTES])
    expect(report.cochange.noHistory).toEqual(['src/shared/lib/fresh.ts'])
    runGit(['reset', '-q', '--hard'], repository)
    runGit(['clean', '-qfd'], repository)
  })

  it('prints one pull request line per missing partner and never changes the repository', () => {
    const before = spawnSync('git', ['status', '--porcelain'], {
      cwd: repository,
      encoding: 'utf8',
    })
    const result = impact([CORE, '--pr-section'])
    expect(result.stdout).toBe(
      `## 🔗 Co-change partners left untouched\n\n- \`${NOTES}\` (with \`${CORE}\`, 8/8): <reason>\n`,
    )
    const after = spawnSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' })
    expect(after.stdout).toBe(before.stdout)
  })

  it('keeps the brief output short', () => {
    const result = impact([CORE, '--brief'])
    expect(result.status).toBe(0)
    expect(result.stdout.split('\n').length).toBeLessThanOrEqual(8)
    expect(result.stdout).toContain('Co-change partners missing: 1')
  })

  it('exits non-zero with usage on bad arguments', () => {
    expect(impact([]).status).toBe(2)
    expect(impact([CORE, '--staged']).status).toBe(2)
    expect(impact([CORE, '--json', '--brief']).status).toBe(2)
    expect(impact(['--nope']).status).toBe(2)
  })

  it('works in a shallow clone from the committed index', () => {
    const result = impact([CORE], shallow)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(NOTES)
  })

  it('refuses --live and index generation in a shallow clone with the unshallow hint', () => {
    for (const result of [
      impact([CORE, '--live'], shallow),
      runScript('impact-index.mjs', shallow),
    ]) {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('git fetch --unshallow')
    }
  })
})

describe('pnpm impact:index', () => {
  it('writes identical bytes twice and reproduces with --check', () => {
    const first = readFileSync(join(repository, INDEX), 'utf8')
    expect(runScript('impact-index.mjs', repository, ['--through', 'HEAD~1']).status).toBe(0)
    expect(readFileSync(join(repository, INDEX), 'utf8')).toBe(first)
    runGit(['checkout', '-q', '--', INDEX], repository)

    const check = runScript('impact-index.mjs', repository, ['--check'])
    expect(check.status, check.stderr).toBe(0)
  })

  it('fails --check when the index is edited by hand', () => {
    const original = readFileSync(join(repository, INDEX), 'utf8')
    writeFileSync(
      join(repository, INDEX),
      original.replace('"pairs": [', '"pairs": [\n    ["a","b",9],'),
    )
    const check = runScript('impact-index.mjs', repository, ['--check'])
    expect(check.status).toBe(1)
    expect(check.stderr).toContain('does not match the history')
    runGit(['checkout', '-q', '--', INDEX], repository)
  })
})
