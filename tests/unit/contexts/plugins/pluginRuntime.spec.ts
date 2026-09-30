// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePluginHostTestFixture } from './pluginHostTestFixture'
import { PluginInstallationManager } from '../../../../src/contexts/plugins/application/PluginInstallationManager'
import { LocalPluginFiles } from '../../../../src/contexts/plugins/infrastructure/LocalPluginFiles'
import { NodePluginBackend } from '../../../../src/contexts/plugins/infrastructure/NodePluginBackend'
import type { PluginBackendPort } from '../../../../src/contexts/plugins/application/PluginRuntimePorts'

let root: string
let source: string
let userData: string
const managers: PluginInstallationManager[] = []
const manifest = {
  apiVersion: 1,
  id: 'test-player',
  version: '1.0.0',
  displayName: 'Player',
  description: 'A real plugin fixture',
  main: 'main.mjs',
  view: { entry: 'ui/index.html' },
  preview: 'ui/preview.html',
  readme: 'README.md',
  icon: { type: 'asset', path: './icon.svg' },
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-plugin-runtime-'))
  source = join(root, 'source')
  userData = join(root, 'profile')
  await mkdir(join(source, 'ui'), { recursive: true })
  await writeFile(join(source, 'opencove.plugin.json'), JSON.stringify(manifest))
  await writeFile(
    join(source, 'main.mjs'),
    'export function activate() { return { invoke: (method, params, context) => ({ method, params, context }) } }',
  )
  await writeFile(
    join(source, 'ui/index.html'),
    '<!doctype html><html><head></head><body>original</body></html>',
  )
  await writeFile(join(source, 'ui/preview.html'), '<html><head></head><body>preview</body></html>')
  await writeFile(join(source, 'README.md'), '# Player\n![Icon](./icon.svg)')
  await writeFile(join(source, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
})
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

function create(
  backend: PluginBackendPort = {
    start: async () => ({ invoke: async () => null, dispose: async () => undefined }),
  },
  files = new LocalPluginFiles(userData),
  scheduleViewExpiry = (expire: () => void): (() => void) => {
    const timer = setTimeout(expire, 180_000)
    timer.unref()
    return () => clearTimeout(timer)
  },
) {
  const manager = new PluginInstallationManager({
    files,
    backend,
    createId: randomUUID,
    reservedIds: ['sample-plugin'],
    scheduleViewExpiry,
  })
  managers.push(manager)
  return { manager, files }
}
async function open(manager: PluginInstallationManager, preview = false) {
  return manager.openView({ pluginId: manifest.id, nodeId: 'node-one', preview })
}
function token(path: string) {
  return path.split('/')[2]
}

describe('independent plugin installation ownership', () => {
  it('reclaims disconnected and abandoned preview processes without stopping a live collapsed or background view', async () => {
    const scheduled = new Set<() => void>()
    const disposed = vi.fn(async () => undefined)
    const { manager, files } = create(
      {
        start: async () => ({ invoke: async () => 'alive', dispose: disposed }),
      },
      new LocalPluginFiles(userData),
      callback => {
        scheduled.add(callback)
        return () => {
          scheduled.delete(callback)
        }
      },
    )
    const removed = vi.spyOn(files, 'removePreviewData')
    await manager.install(source)
    const live = await open(manager)
    manager.attachViewConnection(token(live.resourcePath), vi.fn())
    const preview = await open(manager, true)
    const disconnect = manager.attachViewConnection(token(preview.resourcePath), vi.fn())!
    expect(scheduled.size).toBe(0)
    disconnect()
    for (const expire of scheduled) {
      expire()
    }
    await vi.waitFor(() => expect(removed).toHaveBeenCalledWith(manifest.id, preview.viewId))
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(manager.hasResourceToken(token(preview.resourcePath))).toBe(false)
    expect(await manager.invoke(live.viewId, 'state', null)).toBe('alive')
    const abandoned = await open(manager, true)
    for (const expire of scheduled) {
      expire()
    }
    await vi.waitFor(() => expect(removed).toHaveBeenCalledWith(manifest.id, abandoned.viewId))
    expect(disposed).toHaveBeenCalledTimes(2)
    expect(manager.hasResourceToken(token(live.resourcePath))).toBe(true)
  })

  it('installs, persists storage and enabled intent, restores immutable assets without source, and uninstalls without deleting user files', async () => {
    const { manager } = create()
    const installed = await manager.install(source)
    expect(installed).toMatchObject({
      id: manifest.id,
      source: 'local',
      status: 'ready',
      hasPreview: true,
    })
    const view = await open(manager)
    await manager.storageSet(view.viewId, 'favorites', ['song-1'])
    await manager.setEnabled(manifest.id, false)
    await expect(manager.invoke(view.viewId, 'read', null)).rejects.toThrow('closed')
    await manager.dispose()
    await writeFile(join(source, 'ui/index.html'), 'edited after installation')
    const restored = create().manager
    expect(await restored.list()).toMatchObject([{ enabled: false, status: 'disabled' }])
    await expect(open(restored)).rejects.toThrow('disabled')
    await restored.setEnabled(manifest.id, true)
    const reopened = await open(restored)
    expect(await restored.storageGet(reopened.viewId, 'favorites')).toEqual(['song-1'])
    expect(
      Buffer.from(
        (await restored.resource(token(reopened.resourcePath), 'ui/index.html'))!.body,
      ).toString(),
    ).toContain('original')
    const details = await restored.details(manifest.id)
    expect(details.assets['./icon.svg']).toMatch(/^data:image\/svg\+xml;base64,/)
    await restored.uninstall(manifest.id)
    expect(await restored.list()).toEqual([])
    expect(await readFile(join(source, 'ui/index.html'), 'utf8')).toContain('edited')
    expect(
      await readFile(join(userData, 'plugins/state/test-player/storage/favorites.json'), 'utf8'),
    ).toBe('["song-1"]')
    expect(await restored.resource(token(reopened.resourcePath), 'ui/index.html')).toBeNull()
  })

  it('keeps old generation usable after candidate activation or registry failure and fences views on successful reload', async () => {
    let failStart = false
    const stop = vi.fn(async () => undefined)
    const backend: PluginBackendPort = {
      start: async () => {
        if (failStart) {
          throw new Error('bad source')
        }
        return { invoke: async () => 'original runtime', dispose: stop }
      },
    }
    const { manager, files } = create(backend)
    const first = await manager.install(source)
    const view = await open(manager)
    await writeFile(join(source, 'ui/index.html'), 'candidate')
    failStart = true
    await expect(manager.reload(manifest.id)).rejects.toThrow('bad source')
    expect(await manager.invoke(view.viewId, 'read', null)).toBe('original runtime')
    expect(
      Buffer.from(
        (await manager.resource(token(view.resourcePath), 'ui/index.html'))!.body,
      ).toString(),
    ).toContain('original')
    failStart = false
    vi.spyOn(files, 'writeRegistry').mockRejectedValueOnce(new Error('disk full'))
    await expect(manager.reload(manifest.id)).rejects.toThrow('disk full')
    expect(await manager.invoke(view.viewId, 'read', null)).toBe('original runtime')
    const next = await manager.reload(manifest.id)
    expect(next.revision).not.toBe(first.revision)
    expect(await manager.resource(token(view.resourcePath), 'ui/index.html')).toBeNull()
    await expect(manager.invoke(view.viewId, 'read', null)).rejects.toThrow('closed')
    const again = await manager.reload(manifest.id)
    expect(again.revision).not.toBe(next.revision)
  })

  it('isolates disabled previews and disposes their child and temporary storage', async () => {
    const options: Array<Parameters<PluginBackendPort['start']>[1]> = []
    const stop = vi.fn(async () => undefined)
    const { manager } = create({
      start: async (_snapshot, input) => {
        options.push(input)
        return { invoke: async (_method, _params, context) => context.preview, dispose: stop }
      },
    })
    await manager.install(source)
    const actual = await open(manager)
    await manager.storageSet(actual.viewId, 'favorites', ['real'])
    await manager.setEnabled(manifest.id, false)
    const preview = await open(manager, true)
    expect(options[1].dataDirectory).toContain('/previews/')
    expect(await manager.storageGet(preview.viewId, 'favorites')).toBeNull()
    await manager.storageSet(preview.viewId, 'favorites', ['preview'])
    expect(await manager.invoke(preview.viewId, 'read', null)).toBe(true)
    await manager.closeView(preview.viewId)
    await manager.setEnabled(manifest.id, true)
    expect(await manager.storageGet((await open(manager)).viewId, 'favorites')).toEqual(['real'])
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('cleans failed previews and does not fail committed reload when retiring cleanup fails', async () => {
    let failPreview = false
    const { manager, files } = create({
      start: async (_snapshot, input) => {
        if (input.dataDirectory.includes('/previews/') && failPreview) {
          await mkdir(input.dataDirectory, { recursive: true })
          await writeFile(join(input.dataDirectory, 'temporary'), 'preview')
          throw new Error('preview failed')
        }
        return {
          invoke: async () => 'working',
          dispose: async () => {
            throw new Error('cleanup failed')
          },
        }
      },
    })
    const removePreview = vi.spyOn(files, 'removePreviewData')
    await manager.install(source)
    failPreview = true
    await expect(open(manager, true)).rejects.toThrow('preview failed')
    expect(removePreview).toHaveBeenCalledTimes(1)
    const next = await manager.reload(manifest.id)
    expect(next.status).toBe('ready')
    expect(await manager.invoke((await open(manager)).viewId, 'read', null)).toBe('working')
  })

  it('never publishes a candidate after shutdown during asynchronous activation', async () => {
    let release!: () => void
    const activated = new Promise<void>(accept => {
      release = accept
    })
    const stopped = vi.fn(async () => undefined)
    const started = vi.fn(async () => {
      await activated
      return { invoke: async () => null, dispose: stopped }
    })
    const { manager, files } = create({ start: started })
    const installation = manager.install(source)
    const rejected = expect(installation).rejects.toThrow('shutting down')
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1))
    const closing = manager.dispose()
    release()
    await rejected
    await closing
    expect(await files.readRegistry()).toEqual([])
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid API/platform/path/id collisions and leaves installation registry untouched', async () => {
    const { manager, files } = create()
    // Each case deliberately overwrites the same source before installing it.
    /* eslint-disable no-await-in-loop */
    for (const patch of [
      { apiVersion: 2 },
      { id: 'sample-plugin' },
      { view: { entry: '../outside.html' } },
      { platforms: [process.platform === 'win32' ? 'linux' : 'win32'] },
    ]) {
      await writeFile(
        join(source, 'opencove.plugin.json'),
        JSON.stringify({ ...manifest, ...patch }),
      )
      await expect(manager.install(source)).rejects.toThrow()
    }
    /* eslint-enable no-await-in-loop */
    expect(await files.readRegistry()).toEqual([])
  })
})

describe('real full-Node plugin child', () => {
  it('runs Node backend calls and reports crashes without deleting installation or data', async () => {
    const host = await writePluginHostTestFixture(root)
    await writeFile(
      join(source, 'main.mjs'),
      `import { writeFile, readFile } from 'node:fs/promises';
      export async function activate(context) { context.log('activated'); return {
        async invoke(method, params, view) {
          if (method === 'crash') process.exit(7);
          const path = context.dataDirectory + '/value.txt';
          await writeFile(path, JSON.stringify({ params, preview: view.preview }));
          return JSON.parse(await readFile(path, 'utf8'));
        }
      } }`,
    )
    const { manager } = create(new NodePluginBackend(host))
    await manager.install(source)
    const view = await open(manager)
    expect(await manager.invoke(view.viewId, 'echo', { hello: 'node' })).toEqual({
      params: { hello: 'node' },
      preview: false,
    })
    await expect(manager.invoke(view.viewId, 'crash', null)).rejects.toThrow('exited')
    expect(await manager.list()).toMatchObject([{ enabled: true, status: 'error' }])
    expect((await manager.details(manifest.id)).logs).toContain('activated')
    await manager.reload(manifest.id)
    expect(await manager.list()).toMatchObject([{ enabled: true, status: 'ready' }])
  })
})
