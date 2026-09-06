// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, symlink, writeFile, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('runs publication when invoked through an aliased parent directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-publisher-entry-'))
  try {
    const canonical = join(root, 'real')
    const alias = join(root, 'alias')
    await mkdir(canonical)
    await copyFile(resolve('src/app/cli/publishRuntime.mjs'), join(canonical, 'publishRuntime.mjs'))
    await symlink(canonical, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const result = spawnSync(
      process.execPath,
      [join(alias, 'publishRuntime.mjs'), 'missing', 'unused', 'invalid-digest'],
      {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid artifact digest.')
    expect(result.stdout).toBe('')
    await writeFile(
      join(canonical, 'import.mjs'),
      "import './publishRuntime.mjs'; process.stdout.write('import-only')",
    )
    const imported = spawnSync(process.execPath, [join(alias, 'import.mjs')], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    expect(imported.status).toBe(0)
    expect(imported.stdout).toBe('import-only')
    expect(imported.stderr).toBe('')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
