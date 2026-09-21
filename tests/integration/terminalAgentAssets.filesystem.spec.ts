import { mkdtemp, readFile, readdir, rm, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  const mocked = { ...fs, rename: vi.fn(fs.rename) }
  return { ...mocked, default: mocked }
})

const roots: string[] = []
const stores: TerminalAgentTelemetryAssetStore[] = []
afterEach(async () => {
  vi.mocked(rename).mockReset()
  await Promise.all(stores.splice(0).map(store => store.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opencove-assets-filesystem-'))
  roots.push(root)
  const diagnostic = vi.fn()
  const store = new TerminalAgentTelemetryAssetStore({
    parentDirectory: root,
    platform: process.platform,
    runtimeExecutable: process.execPath,
    diagnostic,
  })
  stores.push(store)
  return { root, store, diagnostic }
}

describe('asset filesystem failure boundaries', () => {
  it('cleans staging after a failed rename and never unlinks the previous script', async () => {
    const { store, diagnostic } = await fixture()
    const assets = await store.ensure()
    expect(rename).toHaveBeenCalledTimes(16)
    const before = await readFile(assets.launcherPath, 'utf8')
    // Corruption makes replacement necessary while leaving a valid old destination to observe.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(assets.launcherPath, before + '\n')
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }))
    await expect(store.ensure()).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(assets.launcherPath, 'utf8')).toBe(before + '\n')
    expect(
      (await readdir(assets.rootDirectory)).filter(name => name.startsWith('.repair-')),
    ).toEqual([])
    expect(diagnostic).not.toHaveBeenCalled()
    expect(await store.ensure()).toEqual(assets)
    expect(await readFile(assets.launcherPath, 'utf8')).toBe(before)
    expect(diagnostic).toHaveBeenCalledWith({ type: 'assets-repaired', count: 1 })
  })

  it.skipIf(process.platform === 'win32')(
    'does not repair through a substituted shim directory link',
    async () => {
      const { root, store } = await fixture()
      const assets = await store.ensure()
      const moved = join(root, 'moved-bin')
      await rename(assets.shimDirectory, moved)
      await symlink(moved, assets.shimDirectory)
      await expect(store.ensure()).rejects.toMatchObject({ code: 'UNSAFE_ASSET' })
      await store.dispose()
      expect(await readdir(moved)).toHaveLength(9)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'rejects a linked parent before creating any generation',
    async () => {
      const { root } = await fixture()
      const alias = join(root, 'alias')
      await symlink(root, alias)
      const store = new TerminalAgentTelemetryAssetStore({
        parentDirectory: alias,
        platform: process.platform,
        runtimeExecutable: process.execPath,
      })
      stores.push(store)
      await expect(store.ensure()).rejects.toMatchObject({ code: 'UNSAFE_ASSET' })
      expect(await readdir(root)).toEqual(['alias'])
    },
  )
  it.skipIf(process.platform === 'win32')(
    'does not follow a runtime directory alias below the trusted profile',
    async () => {
      const { root } = await fixture()
      const outside = await mkdtemp(join(tmpdir(), 'opencove-assets-outside-'))
      roots.push(outside)
      await symlink(outside, join(root, 'runtime'))
      const store = new TerminalAgentTelemetryAssetStore({
        parentDirectory: join(root, 'runtime', 'terminal-agent'),
        trustedDirectory: root,
        platform: process.platform,
        runtimeExecutable: process.execPath,
      })
      stores.push(store)
      await expect(store.ensure()).rejects.toMatchObject({ code: 'UNSAFE_ASSET' })
      expect(await readdir(outside)).toEqual([])
    },
  )
  it.skipIf(process.platform === 'win32')(
    'accepts an intentional alias of the trusted profile itself',
    async () => {
      const { root } = await fixture()
      const alias = join(root, 'profile-alias')
      await symlink(root, alias)
      const store = new TerminalAgentTelemetryAssetStore({
        parentDirectory: join(alias, 'runtime', 'terminal-agent'),
        trustedDirectory: alias,
        platform: process.platform,
        runtimeExecutable: process.execPath,
      })
      stores.push(store)
      const assets = await store.ensure()
      expect(await readFile(assets.shellLauncherPath, 'utf8')).toContain('#!/bin/sh')
      await store.dispose()
      expect(await readdir(join(root, 'runtime', 'terminal-agent'))).toEqual([])
    },
  )
})
