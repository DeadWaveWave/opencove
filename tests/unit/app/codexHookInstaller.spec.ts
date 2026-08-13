import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyManagedCodexHookInstallState,
  installManagedCodexHooks,
  MANAGED_CODEX_HOOK_STATUS_MESSAGE,
  removeManagedCodexHooks,
} from '../../../src/app/main/controlSurface/agentHook/codexHookInstaller'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-codex-hook-install-'))
  roots.push(root)
  await mkdir(join(root, '.codex'), { recursive: true })
  return root
}

describe('managed Codex hook installer', () => {
  it('atomically installs idempotently and removes only managed entries', async () => {
    const home = await createHome()
    const hooksPath = join(home, '.codex', 'hooks.json')
    const unrelated = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/usr/local/bin/unrelated-hook' }],
    }
    await writeFile(
      hooksPath,
      JSON.stringify({ description: 'User hooks', hooks: { PostToolUse: [unrelated] } }),
      'utf8',
    )

    const options = {
      homeDirectory: home,
      helperCommand: '/Applications/Open Cove/Electron',
      helperArgs: ['/Applications/Open Cove/codex-hook.mjs'],
    }
    await expect(installManagedCodexHooks(options)).resolves.toMatchObject({ state: 'installed' })
    await expect(installManagedCodexHooks(options)).resolves.toMatchObject({ state: 'installed' })

    const installed = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(installed.description).toBe('User hooks')
    expect(installed.hooks.PostToolUse).toContainEqual(unrelated)
    expect(installed.hooks.UserPromptSubmit).toHaveLength(1)
    expect(installed.hooks.UserPromptSubmit[0].hooks[0]).toMatchObject({
      type: 'command',
      command:
        "ELECTRON_RUN_AS_NODE=1 '/Applications/Open Cove/Electron' '/Applications/Open Cove/codex-hook.mjs'",
      commandWindows:
        "$env:ELECTRON_RUN_AS_NODE='1'; & '/Applications/Open Cove/Electron' '/Applications/Open Cove/codex-hook.mjs'",
      timeout: 5,
      statusMessage: MANAGED_CODEX_HOOK_STATUS_MESSAGE,
    })
    expect(classifyManagedCodexHookInstallState(installed)).toBe('installed')
    expect((await stat(hooksPath)).mode & 0o777).toBe(0o600)

    const partial = structuredClone(installed)
    delete partial.hooks.PermissionRequest
    expect(classifyManagedCodexHookInstallState(partial)).toBe('partial')

    await expect(removeManagedCodexHooks({ homeDirectory: home })).resolves.toMatchObject({
      state: 'not_installed',
    })
    expect(JSON.parse(await readFile(hooksPath, 'utf8'))).toEqual({
      description: 'User hooks',
      hooks: { PostToolUse: [unrelated] },
    })
  })

  it('does not rewrite invalid JSON', async () => {
    const home = await createHome()
    const hooksPath = join(home, '.codex', 'hooks.json')
    await writeFile(hooksPath, '{ invalid', 'utf8')
    await expect(
      installManagedCodexHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'error' })
    await expect(readFile(hooksPath, 'utf8')).resolves.toBe('{ invalid')
  })

  it('adds a managed file description when the user has none', async () => {
    const home = await createHome()
    await expect(
      installManagedCodexHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'installed' })
    const installed = JSON.parse(await readFile(join(home, '.codex', 'hooks.json'), 'utf8'))
    expect(installed.description).toBe('OpenCove managed agent status hooks')
  })

  it('respects the user hooks feature opt-out', async () => {
    const home = await createHome()
    await writeFile(join(home, '.codex', 'config.toml'), '[features]\nhooks = false\n', 'utf8')
    await expect(
      installManagedCodexHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'skipped', detail: 'hooks_disabled' })
  })

  it('respects managed-only policy restrictions', async () => {
    const home = await createHome()
    await writeFile(join(home, '.codex', 'requirements.toml'), 'allow_managed_hooks_only = true\n')
    await expect(
      installManagedCodexHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'skipped', detail: 'managed_hooks_only' })
  })
})
