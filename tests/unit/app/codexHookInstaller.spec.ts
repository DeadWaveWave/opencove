import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CODEX_HOOK_EVENTS,
  buildManagedCodexHookCommand,
} from '../../../src/shared/runtime/codexHookRuntime'
import {
  classifyManagedCodexHookInstallState,
  installManagedCodexHooks,
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
    const runtimeHome = join(home, 'managed-home')
    const hooksPath = join(runtimeHome, 'hooks.json')
    const userHooksPath = join(home, '.codex', 'hooks.json')
    const scriptPath = join(home, '.opencove', 'agent-hooks', 'codex-hook.sh')
    const unrelated = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/usr/local/bin/unrelated-hook' }],
    }
    await writeFile(
      userHooksPath,
      JSON.stringify({ description: 'User hooks', hooks: { PostToolUse: [unrelated] } }),
      'utf8',
    )

    const options = {
      homeDirectory: home,
      runtimeHomeDirectory: runtimeHome,
      scriptPath,
      codexExecutable: '/missing/codex',
    }
    await expect(installManagedCodexHooks(options)).resolves.toMatchObject({ state: 'installed' })
    await expect(installManagedCodexHooks(options)).resolves.toMatchObject({ state: 'installed' })

    const installed = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(installed.description).toBe('User hooks')
    expect(installed.hooks.PostToolUse).toContainEqual(unrelated)
    expect(installed.hooks.UserPromptSubmit).toHaveLength(1)
    expect(Object.keys(installed.hooks).sort()).toEqual([...CODEX_HOOK_EVENTS].sort())
    expect(installed.hooks.UserPromptSubmit[0].hooks[0]).toEqual({
      type: 'command',
      command: buildManagedCodexHookCommand(scriptPath),
      timeout: 10,
    })
    expect(classifyManagedCodexHookInstallState(installed)).toBe('installed')
    expect((await stat(hooksPath)).mode & 0o777).toBe(0o600)

    const partial = structuredClone(installed)
    delete partial.hooks.PermissionRequest
    expect(classifyManagedCodexHookInstallState(partial)).toBe('partial')

    await expect(
      removeManagedCodexHooks({ homeDirectory: home, runtimeHomeDirectory: runtimeHome }),
    ).resolves.toMatchObject({
      state: 'not_installed',
    })
    expect(JSON.parse(await readFile(hooksPath, 'utf8'))).toEqual({
      description: 'User hooks',
      hooks: { PostToolUse: [unrelated] },
    })
  })

  it('does not rewrite invalid JSON', async () => {
    const home = await createHome()
    const runtimeHome = join(home, 'managed-home')
    await mkdir(runtimeHome, { recursive: true })
    const hooksPath = join(runtimeHome, 'hooks.json')
    await writeFile(hooksPath, '{ invalid', 'utf8')
    await expect(
      installManagedCodexHooks({
        homeDirectory: home,
        runtimeHomeDirectory: runtimeHome,
        scriptPath: join(home, 'hook.sh'),
        codexExecutable: '/missing/codex',
      }),
    ).resolves.toMatchObject({ state: 'error' })
    await expect(readFile(hooksPath, 'utf8')).resolves.toBe('{ invalid')
  })

  it('adds a managed file description when the user has none', async () => {
    const home = await createHome()
    const runtimeHome = join(home, 'managed-home')
    await expect(
      installManagedCodexHooks({
        homeDirectory: home,
        runtimeHomeDirectory: runtimeHome,
        scriptPath: join(home, 'hook.sh'),
        codexExecutable: '/missing/codex',
      }),
    ).resolves.toMatchObject({ state: 'installed' })
    const installed = JSON.parse(await readFile(join(runtimeHome, 'hooks.json'), 'utf8'))
    expect(installed.description).toBe('OpenCove managed agent status hooks')
  })

  it('respects the user hooks feature opt-out', async () => {
    const home = await createHome()
    await writeFile(join(home, '.codex', 'config.toml'), '[features]\nhooks = false\n', 'utf8')
    await expect(installManagedCodexHooks({ homeDirectory: home })).resolves.toMatchObject({
      state: 'skipped',
      detail: 'hooks_disabled',
    })
  })

  it('respects managed-only policy restrictions', async () => {
    const home = await createHome()
    await writeFile(join(home, '.codex', 'requirements.toml'), 'allow_managed_hooks_only = true\n')
    await expect(installManagedCodexHooks({ homeDirectory: home })).resolves.toMatchObject({
      state: 'skipped',
      detail: 'managed_hooks_only',
    })
  })
})
