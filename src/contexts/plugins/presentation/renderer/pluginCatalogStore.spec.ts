import { describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import { createPluginCatalogStore } from './pluginCatalogStore'

const initial: readonly PluginManifest[] = [
  {
    id: 'sample-plugin',
    version: '1.0.0',
    displayName: 'Sample',
    description: 'Sample',
    nodeKinds: ['sample-plugin'],
    actionBar: true,
    contextMenu: true,
    source: 'local',
  },
]
const extra = { ...initial[0], id: 'music', displayName: 'Music' }

describe('renderer plugin catalog ownership', () => {
  it('coalesces discovery and preserves snapshots and plugin identity for unchanged manifests', async () => {
    const load = vi.fn().mockResolvedValue(initial.map(plugin => ({ ...plugin })))
    const store = createPluginCatalogStore(initial, load)
    const changed = vi.fn()
    store.subscribe(changed)
    const before = store.getSnapshot()
    await Promise.all([store.refresh(), store.refresh(), store.refresh()])
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(before)
    expect(changed).not.toHaveBeenCalled()
    load.mockResolvedValue([...initial.map(plugin => ({ ...plugin })), extra])
    await store.refresh()
    expect(store.getSnapshot().plugins[0]).toBe(initial[0])
    expect(store.getSnapshot().plugins[1]).toBe(extra)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('keeps the last successful registry on discovery failure and clears errors on recovery', async () => {
    const load = vi.fn().mockResolvedValue([...initial, extra])
    const store = createPluginCatalogStore(initial, load)
    await store.refresh()
    load.mockRejectedValue(new Error('Worker unavailable'))
    await store.refresh()
    expect(store.getSnapshot().plugins).toEqual([...initial, extra])
    expect(store.getSnapshot().error).toBe('Worker unavailable')
    load.mockResolvedValue(initial)
    await store.refresh()
    expect(store.getSnapshot()).toEqual({ plugins: initial, error: null })
  })

  it('ignores stale discovery when the owning connection lifecycle ends', async () => {
    let finish: (plugins: typeof initial) => void = () => undefined
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<typeof initial>(resolve => {
            finish = resolve
          }),
      )
      .mockResolvedValue(initial)
    const store = createPluginCatalogStore(initial, load)
    const stale = store.refresh()
    await Promise.resolve()
    store.invalidate()
    await store.refresh()
    finish([...initial, extra])
    await stale
    expect(store.getSnapshot().plugins).toEqual(initial)
  })
})
