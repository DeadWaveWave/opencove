import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')
const oxlintCli = resolve(rootDir, 'node_modules/oxlint/bin/oxlint')

// Every probe is the same function, with one comment above a line that does not type-check.
function probe(comment: string): string {
  return [
    'export function probe(input: number): string {',
    `  ${comment}`,
    '  const value: string = input',
    '  return value',
    '}',
    '',
  ].join('\n')
}

const described = '// @ts-expect-error a number is not a string'
const noCheck = `// @ts-nocheck\n${probe('// nothing to see here')}`

const probes = [
  // Production code: no suppression comment is accepted, described or not.
  { file: 'src/feature/described.ts', source: probe(described), refused: true },
  {
    file: 'src/feature/block.tsx',
    source: probe('/* @ts-expect-error a number is not a string */'),
    refused: true,
  },
  { file: 'src/feature/ignore.ts', source: probe('// @ts-ignore'), refused: true },
  { file: 'src/feature/nocheck.ts', source: noCheck, refused: true },
  {
    file: 'src/feature/mention.ts',
    source: probe('// a sentence that mentions @ts-expect-error is not a directive'),
    refused: false,
  },
  // Test code: a type test may expect an error, and has to say which.
  { file: 'src/feature/described.spec.ts', source: probe(described), refused: false },
  { file: 'src/feature/described.spec.tsx', source: probe(described), refused: false },
  { file: 'src/feature/bare.spec.ts', source: probe('// @ts-expect-error'), refused: true },
  {
    file: 'src/feature/ignore.spec.ts',
    source: probe('// @ts-ignore a number is not a string'),
    refused: true,
  },
  { file: 'tests/support/described.ts', source: probe(described), refused: false },
  { file: 'tests/support/nocheck.ts', source: noCheck, refused: true },
]

function runOxlint(cwd: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      process.execPath,
      [oxlintCli, '-c', '.oxlintrc.json', '--format', 'json', '.'],
      { cwd },
      (error, stdout) => {
        // oxlint exits with 1 when it reports an error, which is what most probes are for.
        if (error && !stdout.trim().startsWith('{')) {
          reject(error)
          return
        }
        resolveOutput(stdout)
      },
    )
  })
}

describe('TypeScript suppression comments', () => {
  let directory = ''
  let refusedFiles = new Set<string>()

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'opencove-lint-'))
    await copyFile(resolve(rootDir, '.oxlintrc.json'), join(directory, '.oxlintrc.json'))
    await Promise.all(
      probes.map(async ({ file, source }) => {
        await mkdir(dirname(join(directory, file)), { recursive: true })
        await writeFile(join(directory, file), source)
      }),
    )

    const report = JSON.parse(await runOxlint(directory)) as {
      diagnostics: Array<{ code: string; severity: string; filename: string }>
    }
    refusedFiles = new Set(
      report.diagnostics
        .filter(entry => entry.code.includes('ban-ts-comment') && entry.severity === 'error')
        .map(entry => entry.filename.replaceAll('\\', '/')),
    )
  }, 60_000)

  afterAll(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(probes)(
    '$file is refused by the repository lint config: $refused',
    ({ file, refused }) => {
      expect(refusedFiles.has(file)).toBe(refused)
    },
  )

  it('lints again after the auto-fix pass of the quick gate', async () => {
    const pkg = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))

    // `oxlint --fix` rewrites `@ts-ignore` to `@ts-expect-error` and reports nothing in that run,
    // so only a second, read-only run sees what the fix left behind.
    expect(pkg.scripts['lint:fix']).toBe('oxlint --fix .')
    expect(pkg.scripts.lint).toBe('oxlint .')
    expect(pkg.scripts['verify:checks']).toContain(' && pnpm lint:fix && pnpm lint && ')
  })
})
