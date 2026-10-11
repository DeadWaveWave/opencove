// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeLocalPluginPackage } from '../../../../src/contexts/plugins/domain/localPluginValidation'
import { assertPluginCompatibility } from '../../../../src/contexts/plugins/domain/pluginCompatibility'
import { LocalPluginFiles } from '../../../../src/contexts/plugins/infrastructure/LocalPluginFiles'
import { PluginInstallationManager } from '../../../../src/contexts/plugins/application/PluginInstallationManager'

const pkg = {
  apiVersion: 1,
  id: 'compatibility-fixture',
  version: '1.0.0',
  displayName: 'Compatibility fixture',
  description: 'Checks compatibility before activation',
  main: 'main.mjs',
  view: { entry: 'index.html' },
}
const roots: string[] = []
const managers: PluginInstallationManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function check(version: string | null, range = '>=0.3.2 <0.4.0') {
  assertPluginCompatibility(
    { id: pkg.id, engines: { opencove: range } },
    { version, platform: 'linux' },
  )
}
async function fixture(extra: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-plugin-compatibility-'))
  roots.push(root)
  const source = join(root, 'source')
  const profile = join(root, 'profile')
  await mkdir(source)
  await writeFile(join(source, 'opencove.plugin.json'), JSON.stringify({ ...pkg, ...extra }))
  await writeFile(join(source, 'main.mjs'), 'original')
  await writeFile(join(source, 'index.html'), '<html>Original window</html>')
  return { root, source, profile }
}
function runtime(profile: string, version: string | null, platform: NodeJS.Platform = 'linux') {
  const files = new LocalPluginFiles(profile, platform, version)
  const start = vi.fn(async () => ({
    invoke: async () => 'original backend',
    dispose: async () => undefined,
  }))
  const manager = new PluginInstallationManager({
    files,
    backend: { start },
    createId: randomUUID,
    reservedIds: [],
    scheduleViewExpiry: () => () => undefined,
  })
  managers.push(manager)
  return { manager, files, start }
}

describe('declared plugin compatibility', () => {
  it('preserves API 1 packages without a host range and rejects unsupported API versions', () => {
    const normalized = normalizeLocalPluginPackage(pkg)
    expect(normalized).not.toHaveProperty('engines')
    expect(() =>
      assertPluginCompatibility(normalized, { version: null, platform: 'linux' }),
    ).not.toThrow()
    expect(() => normalizeLocalPluginPackage({ ...pkg, apiVersion: 2 })).toThrow('requires 1')
    expect(
      normalizeLocalPluginPackage({ ...pkg, engines: { opencove: ' >=0.3.2 <0.4.0 ' } }).engines,
    ).toEqual({ opencove: '>=0.3.2 <0.4.0' })
  })

  it.each([
    null,
    [],
    {},
    { opencove: '' },
    { opencove: 'latest' },
    { opencove: 1 },
    { node: '>=22' },
  ])('rejects an invalid engines declaration: %j', engines => {
    expect(() => normalizeLocalPluginPackage({ ...pkg, engines })).toThrow('engines')
  })

  it('honors inclusive lower, exclusive upper, caret and OR ranges', () => {
    expect(() => check('0.3.2')).not.toThrow()
    expect(() => check('0.3.9+build.4')).not.toThrow()
    expect(() => check('0.3.1')).toThrow('Update the Worker')
    expect(() => check('0.4.0')).toThrow('0.4.0')
    expect(() => check('0.3.3', '^0.3.2')).not.toThrow()
    expect(() => check('0.4.0', '^0.3.2')).toThrow()
    expect(() => check('1.2.0', '^0.3.2 || ^1.0.0')).not.toThrow()
  })

  it('requires explicit prerelease opt-in and refuses to guess an unknown host version', () => {
    expect(() => check('0.3.3-nightly.5')).toThrow()
    expect(() => check('0.3.3-nightly.5', '>=0.3.3-nightly.1 <0.3.3')).not.toThrow()
    expect(() => check(null)).toThrow('version is unavailable')
    expect(() => check('unknown')).toThrow('version is unavailable')
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'checks Worker platform %s independently of the client',
    platform => {
      expect(() =>
        assertPluginCompatibility(
          { id: pkg.id, platforms: [platform] },
          { version: null, platform },
        ),
      ).not.toThrow()
      const other = platform === 'linux' ? 'win32' : 'linux'
      expect(() =>
        assertPluginCompatibility({ id: pkg.id, platforms: [other] }, { version: null, platform }),
      ).toThrow(`this Worker runs ${platform}`)
    },
  )
})

describe('compatibility admission and recovery', () => {
  it('rejects installation before backend activation and does not write the registry', async () => {
    const { source, profile } = await fixture({ engines: { opencove: '>=1.0.0' } })
    const { manager, files, start } = runtime(profile, '0.3.2')
    await expect(manager.install(source)).rejects.toThrow('requires OpenCove >=1.0.0')
    expect(start).not.toHaveBeenCalled()
    expect(await files.readRegistry()).toEqual([])
  })

  it('preserves an active window, backend, data and registry after an incompatible reload', async () => {
    const { source, profile } = await fixture()
    const { manager, files, start } = runtime(profile, '0.3.2')
    const installed = await manager.install(source)
    const view = await manager.openView({ pluginId: pkg.id, nodeId: 'original-node' })
    await manager.storageSet(view.viewId, 'content', { value: 'keep me' })
    const registry = await files.readRegistry()
    await writeFile(
      join(source, 'opencove.plugin.json'),
      JSON.stringify({ ...pkg, engines: { opencove: '>=1.0.0' } }),
    )
    await expect(manager.reload(pkg.id)).rejects.toThrow('requires OpenCove >=1.0.0')
    expect(start).toHaveBeenCalledTimes(1)
    expect(await manager.invoke(view.viewId, 'read', null)).toBe('original backend')
    expect(await manager.storageGet(view.viewId, 'content')).toEqual({ value: 'keep me' })
    expect(await manager.list()).toMatchObject([{ revision: installed.revision, status: 'ready' }])
    expect(await files.readRegistry()).toEqual(registry)
  })

  it('isolates incompatibility on restart without erasing enabled intent, other plugins or private data', async () => {
    const { source, profile, root } = await fixture({ engines: { opencove: '^0.3.2' } })
    const first = runtime(profile, '0.3.2')
    await first.manager.install(source)
    const view = await first.manager.openView({ pluginId: pkg.id, nodeId: 'saved' })
    await first.manager.storageSet(view.viewId, 'saved', 42)
    const legacy = join(root, 'legacy')
    await mkdir(legacy)
    await writeFile(
      join(legacy, 'opencove.plugin.json'),
      JSON.stringify({ ...pkg, id: 'legacy-package' }),
    )
    await writeFile(join(legacy, 'main.mjs'), 'legacy')
    await writeFile(join(legacy, 'index.html'), '<html>legacy</html>')
    await first.manager.install(legacy)
    const savedRegistry = await first.files.readRegistry()
    await first.manager.dispose()

    const upgraded = runtime(profile, '0.4.0')
    expect(await upgraded.manager.list()).toMatchObject([
      {
        id: pkg.id,
        enabled: true,
        status: 'error',
        error: expect.stringContaining('requires OpenCove ^0.3.2'),
      },
      { id: 'legacy-package', status: 'ready' },
    ])
    expect(upgraded.start).toHaveBeenCalledTimes(1)
    expect(await upgraded.files.readRegistry()).toEqual(savedRegistry)
    expect(
      await readFile(join(profile, 'plugins/state', pkg.id, 'storage/saved.json'), 'utf8'),
    ).toBe('42')
    await upgraded.manager.dispose()
    const recovered = runtime(profile, '0.3.3')
    expect(await recovered.manager.list()).toMatchObject([
      { id: pkg.id, status: 'ready' },
      { id: 'legacy-package', status: 'ready' },
    ])
  })
})
