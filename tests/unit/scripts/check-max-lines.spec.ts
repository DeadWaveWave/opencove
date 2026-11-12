import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const temporaryDirectories: string[] = []

function createModule(lineCount: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'opencove-max-lines-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'authored-script.mjs')
  writeFileSync(path, 'export const value = 1\n'.repeat(lineCount))
  return path
}

function createStylesheet(relativePath: string, lineCount: number): string {
  const directory = mkdtempSync(join(tmpdir(), 'opencove-max-lines-'))
  temporaryDirectories.push(directory)
  const path = join(directory, relativePath)
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, '  --cove-token: #000;\n'.repeat(lineCount))
  return path
}

function checkMaxLines(path: string) {
  return spawnSync(
    process.execPath,
    [join(repositoryRoot, 'scripts', 'check-max-lines.mjs'), path],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('max-lines authored extension coverage', () => {
  it('checks authored ESM scripts while preserving the 500-line boundary', () => {
    const accepted = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts', 'check-max-lines.mjs'), createModule(500)],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
    const rejected = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts', 'check-max-lines.mjs'), createModule(501)],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )

    expect(accepted.status).toBe(0)
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('authored-script.mjs: 501 lines')
  })

  it('skips the theme stylesheets `pnpm design:tokens` writes, but not authored theme CSS', () => {
    const generated = createStylesheet('src/app/renderer/styles/themes/generated/cove.css', 600)
    const authored = createStylesheet('src/app/renderer/styles/themes/pixel.css', 600)

    expect(checkMaxLines(generated).status).toBe(0)
    const rejected = checkMaxLines(authored)
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('pixel.css: 600 lines')
  })
})
