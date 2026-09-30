import { describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import type { PluginDetails } from '../../domain/pluginRuntimeTypes'
import { createPluginDetailsStore } from './pluginDetailsStore'

const plugin: PluginManifest = {
  id: 'music',
  displayName: 'Music',
  version: '1.0.0',
  description: '',
  source: 'local',
  nodeKinds: ['music'],
  actionBar: true,
  contextMenu: true,
  revision: 'one',
  status: 'ready',
  enabled: true,
}
const detail = (manifest = plugin, logs = ['ready']): PluginDetails => ({
  plugin: manifest,
  readme: '# Music',
  assets: { './icon.svg': 'data:image/svg+xml,example' },
  sourceDirectory: '/plugins/music',
  logs,
})

describe('plugin detail cache lifecycle', () => {
  it('shares active requests and evicts an unobserved old revision without publishing late results', async () => {
    let finish: (value: PluginDetails) => void = () => undefined
    const nextPlugin = { ...plugin, revision: 'two' }
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<PluginDetails>(resolve => {
            finish = resolve
          }),
      )
      .mockResolvedValue(detail(nextPlugin))
    const store = createPluginDetailsStore(fetch)
    const old = store.get(plugin)
    const changed = vi.fn()
    const unsubscribe = old.subscribe(changed)
    const pending = old.load(plugin)
    expect(old.load(plugin)).toBe(pending)
    await Promise.resolve()
    const current = store.get(nextPlugin)
    const stopCurrent = current.subscribe(vi.fn())
    unsubscribe()
    await Promise.resolve()
    await current.load(nextPlugin)
    finish(detail(plugin))
    await pending
    expect(old.getSnapshot().detail).toBeNull()
    expect(changed).not.toHaveBeenCalled()
    expect(current.getSnapshot().detail?.plugin.revision).toBe('two')
    expect(fetch).toHaveBeenCalledTimes(2)
    stopCurrent()
  })

  it('bounds inactive assets while retaining documents actively displayed in settings', async () => {
    const store = createPluginDetailsStore(async () => detail(), 2)
    const retained = store.get(plugin)
    const stop = retained.subscribe(vi.fn())
    const first = store.get({ ...plugin, id: 'first' })
    store.get({ ...plugin, id: 'second' })
    store.get({ ...plugin, id: 'third' })
    expect(store.get(plugin)).toBe(retained)
    expect(store.get({ ...plugin, id: 'first' })).not.toBe(first)
    stop()
  })

  it('refreshes logs when status changes or reload fails without destroying previously loaded documentation', async () => {
    const fetch = vi.fn().mockResolvedValue(detail())
    const store = createPluginDetailsStore(fetch)
    const entry = store.get(plugin)
    const stop = entry.subscribe(vi.fn())
    await entry.load(plugin)
    await entry.load({ ...plugin })
    expect(fetch).toHaveBeenCalledTimes(1)
    const errored = { ...plugin, status: 'error' as const, error: 'Backend exited' }
    fetch.mockResolvedValue(detail(errored, ['ready', 'Backend exited']))
    await entry.load(errored)
    expect(entry.getSnapshot().detail?.logs).toContain('Backend exited')
    fetch.mockRejectedValueOnce({
      message: 'Invalid request',
      debugMessage: 'Could not read metadata',
    })
    await entry.load(errored, true)
    expect(entry.getSnapshot().detail?.readme).toBe('# Music')
    expect(entry.getSnapshot().error).toBe('Could not read metadata')
    fetch.mockResolvedValue(detail(errored, ['Reload candidate failed']))
    store.refresh(plugin.id)
    await entry.load(errored)
    expect(entry.getSnapshot().detail?.logs).toEqual(['Reload candidate failed'])
    stop()
  })

  it('refreshes source metadata after a same-revision runtime replacement', async () => {
    const current = { ...plugin, runtimeGeneration: 1 }
    const next = { ...current, runtimeGeneration: 2 }
    const fetch = vi.fn().mockResolvedValue(detail(current))
    const store = createPluginDetailsStore(fetch)
    const entry = store.get(current)
    await entry.load(current)
    fetch.mockResolvedValue({ ...detail(next), sourceDirectory: '/candidates/music' })
    expect(store.get(next)).toBe(entry)
    await entry.load(next)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(entry.getSnapshot().detail?.sourceDirectory).toBe('/candidates/music')
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores an older generation request that completes with %s after replacement',
    async completion => {
      const current = { ...plugin, runtimeGeneration: 1 }
      const next = { ...current, runtimeGeneration: 2 }
      let finish: (value: PluginDetails) => void = () => undefined
      let fail: (reason: Error) => void = () => undefined
      const fetch = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<PluginDetails>((resolve, reject) => {
              finish = resolve
              fail = reject
            }),
        )
        .mockResolvedValue({ ...detail(next), sourceDirectory: '/candidates/music' })
      const store = createPluginDetailsStore(fetch)
      const entry = store.get(current)
      const snapshots: Array<ReturnType<typeof entry.getSnapshot>> = []
      const stop = entry.subscribe(() => snapshots.push(entry.getSnapshot()))
      const pending = entry.load(current)
      await Promise.resolve()
      store.get(next)
      void entry.load(next)
      if (completion === 'resolve') {
        finish(detail(current))
      } else {
        fail(new Error('Old runtime unavailable'))
      }
      await pending
      await vi.waitFor(() =>
        expect(entry.getSnapshot().detail?.sourceDirectory).toBe('/candidates/music'),
      )
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].error).toBeNull()
      expect(snapshots[0].detail?.plugin.runtimeGeneration).toBe(2)
      stop()
    },
  )

  it('rejects a response from a different runtime generation with unchanged code', async () => {
    const current = { ...plugin, runtimeGeneration: 1 }
    const store = createPluginDetailsStore(async () => detail({ ...current, runtimeGeneration: 2 }))
    const entry = store.get(current)
    await entry.load(current)
    expect(entry.getSnapshot().detail).toBeNull()
  })

  it('never labels a newer backend response with an older cached revision', async () => {
    const store = createPluginDetailsStore(async () => detail({ ...plugin, revision: 'newer' }))
    const entry = store.get(plugin)
    await entry.load(plugin)
    expect(entry.getSnapshot().detail).toBeNull()
  })
})
