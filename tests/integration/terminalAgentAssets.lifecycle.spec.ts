import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

import { TerminalAgentAssetFiles } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentAssetFiles'

const roots: string[] = []
const stores: TerminalAgentTelemetryAssetStore[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(stores.splice(0).map(store => store.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opencove-assets-test-'))
  roots.push(root)
  const options = {
    parentDirectory: root,
    platform: process.platform,
    runtimeExecutable: process.execPath,
  }
  const store = new TerminalAgentTelemetryAssetStore(options)
  stores.push(store)
  return { root, store }
}

describe('terminal Agent asset lifetime', () => {
  it('creates only inside the explicitly owned parent', async () => {
    const { root, store } = await fixture()
    const assets = await store.ensure()
    expect(Object.isFrozen(assets)).toBe(true)
    expect(assets.rootDirectory.startsWith(root + sep)).toBe(true)
  })

  it.each(['partial', 'complete'])(
    'repairs %s deletion at the original published paths',
    async kind => {
      const { store } = await fixture()
      const assets = await store.ensure()
      const original = await readFile(assets.shellLauncherPath, 'utf8')
      if (kind === 'complete') {
        await rm(assets.rootDirectory, { recursive: true })
      } else {
        await rm(assets.shellLauncherPath)
      }
      const repaired = await Promise.all(Array.from({ length: 20 }, () => store.ensure()))
      expect(repaired.every(result => result.rootDirectory === assets.rootDirectory)).toBe(true)
      expect(await readFile(assets.shellLauncherPath, 'utf8')).toBe(original)
      expect(await readdir(assets.shimDirectory)).toHaveLength(9)
    },
  )

  it('repairs generated content without touching history or invocation plans', async () => {
    const { store } = await fixture()
    const assets = await store.ensure()
    const original = await readFile(assets.launcherPath, 'utf8')
    const history = join(assets.zshDotDirectory, '.zsh_history')
    const plan = join(assets.planDirectory, 'active.json')
    await writeFile(history, 'user history')
    await writeFile(plan, 'active plan')
    await writeFile(assets.launcherPath, 'broken')
    await store.ensure()
    expect(await readFile(assets.launcherPath, 'utf8')).toBe(original)
    expect(await readFile(history, 'utf8')).toBe('user history')
    expect(await readFile(plan, 'utf8')).toBe('active plan')
  })

  it('fences in-flight creation and never resurrects after disposal', async () => {
    const { root, store } = await fixture()
    const pending = store.ensure()
    const outcome = pending.then(
      () => 'published',
      () => 'rejected',
    )
    await store.dispose()
    const result = await outcome
    // Settle before asserting so even the broken implementation can be cleaned up.
    await store.dispose()
    expect(result).toBe('rejected')
    expect(await readdir(root)).toEqual([])
    await expect(store.ensure()).rejects.toThrow(/disposed/i)
  })
  it('shares in-flight validation and drains a paused repair before disposal', async () => {
    const { store } = await fixture()
    const assets = await store.ensure()
    await rm(assets.launcherPath)
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>(resolve => {
      started = resolve
    })
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    const original = TerminalAgentAssetFiles.prototype.ensureFile
    const write = vi
      .spyOn(TerminalAgentAssetFiles.prototype, 'ensureFile')
      .mockImplementation(async function (file) {
        started()
        await blocked
        return await original.call(this, file)
      })
    const pending = Promise.allSettled(Array.from({ length: 20 }, () => store.ensure()))
    await entered
    let disposed = false
    const closing = store.dispose().then(() => {
      disposed = true
    })
    try {
      await Promise.resolve()
      expect(disposed).toBe(false)
      await expect(store.ensure()).rejects.toThrow(/disposed/i)
    } finally {
      release()
    }
    await closing
    expect((await pending).every(result => result.status === 'rejected')).toBe(true)
    expect(write).toHaveBeenCalledTimes(16)
    await expect(lstat(assets.rootDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries after failed repair without allocating another root', async () => {
    const { root, store } = await fixture()
    const assets = await store.ensure()
    await rm(assets.launcherPath)
    const repair = vi.spyOn(TerminalAgentAssetFiles.prototype, 'ensureFile')
    repair.mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    await expect(store.ensure()).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(await store.ensure()).toEqual(assets)
    expect(await readdir(root)).toHaveLength(1)
    expect(await readdir(assets.rootDirectory)).not.toContain(expect.stringMatching(/^\.repair-/))
  })

  it('does not rewrite healthy assets or remove another instance', async () => {
    const { root, store } = await fixture()
    const sibling = new TerminalAgentTelemetryAssetStore({
      parentDirectory: root,
      platform: process.platform,
      runtimeExecutable: process.execPath,
    })
    stores.push(sibling)
    const assets = await store.ensure()
    const other = await sibling.ensure()
    const before = await lstat(assets.launcherPath)
    await store.ensure()
    const after = await lstat(assets.launcherPath)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    await Promise.all([store.dispose(), store.dispose()])
    expect((await lstat(other.launcherPath)).isFile()).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'repairs permissions and replaces without truncating an open reader',
    async () => {
      const { store } = await fixture()
      const assets = await store.ensure()
      const original = await readFile(assets.shellLauncherPath, 'utf8')
      await writeFile(assets.shellLauncherPath, 'old bytes')
      const reader = await open(assets.shellLauncherPath, 'r')
      try {
        await chmod(assets.shellLauncherPath, 0o000)
        await store.ensure()
        expect(await reader.readFile('utf8')).toBe('old bytes')
        expect(await readFile(assets.shellLauncherPath, 'utf8')).toBe(original)
        expect((await lstat(assets.shellLauncherPath)).mode & 0o777).toBe(0o700)
      } finally {
        await reader.close()
      }
    },
  )

  it.each(
    process.platform === 'win32' ? ['hardlink', 'directory'] : ['symlink', 'hardlink', 'directory'],
  )('refuses a %s in place of a generated file', async kind => {
    const { root, store } = await fixture()
    const assets = await store.ensure()
    const outside = join(root, 'outside')
    await writeFile(outside, 'do not modify')
    await rm(assets.launcherPath)
    if (kind === 'symlink') {
      await symlink(outside, assets.launcherPath)
    }
    if (kind === 'hardlink') {
      await link(outside, assets.launcherPath)
    }
    if (kind === 'directory') {
      await mkdir(assets.launcherPath)
    }
    await expect(store.ensure()).rejects.toMatchObject({ code: 'UNSAFE_ASSET' })
    expect(await readFile(outside, 'utf8')).toBe('do not modify')
    await rm(assets.launcherPath, { recursive: true })
    await expect(store.ensure()).resolves.toEqual(assets)
  })

  it('refuses to repair or dispose an externally replaced root', async () => {
    const { root, store } = await fixture()
    const assets = await store.ensure()
    const moved = join(root, 'original')
    await rename(assets.rootDirectory, moved)
    await mkdir(assets.rootDirectory, { mode: 0o700 })
    const sentinel = join(assets.rootDirectory, 'unowned')
    await writeFile(sentinel, 'preserved')
    await expect(store.ensure()).rejects.toMatchObject({ code: 'UNSAFE_ASSET' })
    await expect(store.dispose()).rejects.toMatchObject({ code: 'UNSAFE_ASSET' })
    expect(await readFile(sentinel, 'utf8')).toBe('preserved')
    stores.splice(stores.indexOf(store), 1) // Failed safe disposal is the expected result.
  })
})
