import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyManagedClaudeHookInstallState,
  installManagedClaudeHooks,
  removeManagedClaudeHooks,
} from '../../../src/app/main/controlSurface/agentHook/claudeHookInstaller'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-claude-hook-install-'))
  roots.push(root)
  await mkdir(join(root, '.claude'), { recursive: true })
  return root
}

describe('managed Claude hook installer', () => {
  it('atomically installs and removes only managed entries', async () => {
    const home = await createHome()
    const settingsPath = join(home, '.claude', 'settings.json')
    const unrelated = {
      matcher: 'Write',
      hooks: [{ type: 'command', command: '/usr/local/bin/unrelated-hook' }],
    }
    await writeFile(
      settingsPath,
      JSON.stringify({ hooks: { PostToolUse: [unrelated] }, theme: 'dark' }),
      'utf8',
    )

    await expect(
      installManagedClaudeHooks({
        homeDirectory: home,
        helperCommand: '/Applications/Open Cove/Electron',
        helperArgs: ['/Applications/Open Cove/hook.mjs'],
        platform: 'darwin',
      }),
    ).resolves.toMatchObject({ state: 'installed' })

    const installed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(installed.theme).toBe('dark')
    expect(installed.hooks.PostToolUse).toContainEqual(unrelated)
    expect(installed.hooks.UserPromptSubmit.at(-1).hooks[0].command).toBe(
      "ELECTRON_RUN_AS_NODE=1 '/Applications/Open Cove/Electron' '/Applications/Open Cove/hook.mjs'",
    )
    expect(installed.hooks.PreToolUse.at(-1).matcher).toBeUndefined()
    expect(classifyManagedClaudeHookInstallState(installed)).toBe('installed')

    const partial = structuredClone(installed)
    delete partial.hooks.PermissionRequest
    expect(classifyManagedClaudeHookInstallState(partial)).toBe('partial')

    await expect(removeManagedClaudeHooks({ homeDirectory: home })).resolves.toMatchObject({
      state: 'not_installed',
    })

    const removed = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(removed).toEqual({ hooks: { PostToolUse: [unrelated] }, theme: 'dark' })
    expect(classifyManagedClaudeHookInstallState(removed)).toBe('not_installed')
  })

  it('does not rewrite invalid JSON', async () => {
    const home = await createHome()
    const settingsPath = join(home, '.claude', 'settings.json')
    await writeFile(settingsPath, '{ invalid', 'utf8')

    await expect(
      installManagedClaudeHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'error' })
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe('{ invalid')
  })

  it('respects disableAllHooks and reports a visible-degradation state', async () => {
    const home = await createHome()
    const settingsPath = join(home, '.claude', 'settings.json')
    await writeFile(settingsPath, JSON.stringify({ disableAllHooks: true }), 'utf8')

    await expect(
      installManagedClaudeHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'skipped' })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ disableAllHooks: true })
  })

  it('respects managed-hook policy restrictions', async () => {
    const home = await createHome()
    const settingsPath = join(home, '.claude', 'settings.json')
    await writeFile(settingsPath, JSON.stringify({ allowManagedHooksOnly: true }), 'utf8')

    await expect(
      installManagedClaudeHooks({ homeDirectory: home, helperCommand: 'managed helper' }),
    ).resolves.toMatchObject({ state: 'skipped', detail: 'managed_hooks_only' })
    expect(classifyManagedClaudeHookInstallState({ allowManagedHooksOnly: true })).toBe('skipped')
  })

  it('uses an explicit PowerShell command when installing on Windows', async () => {
    const home = await createHome()
    await expect(
      installManagedClaudeHooks({
        homeDirectory: home,
        helperCommand: 'C:\\Program Files\\Open Cove\\OpenCove.exe',
        helperArgs: ['C:\\Program Files\\Open Cove\\hook.mjs'],
        platform: 'win32',
      }),
    ).resolves.toMatchObject({ state: 'installed' })

    const installed = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'))
    expect(installed.hooks.UserPromptSubmit.at(-1).hooks[0]).toMatchObject({
      shell: 'powershell',
      command:
        "$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\Program Files\\Open Cove\\OpenCove.exe' 'C:\\Program Files\\Open Cove\\hook.mjs'",
    })
  })
})
