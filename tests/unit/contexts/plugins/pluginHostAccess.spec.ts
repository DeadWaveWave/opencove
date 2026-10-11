// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PluginHostAccess } from '../../../../src/contexts/plugins/application/PluginHostAccess'
import type {
  PluginRuntimeState,
  PluginRuntimeView,
} from '../../../../src/contexts/plugins/application/PluginRuntimeState'
const runtime = {
  record: { enabled: true, package: { id: 'test' } },
  error: null,
} as PluginRuntimeState
function view(preview = false): PluginRuntimeView {
  return { id: 'view', context: { preview }, runtime } as PluginRuntimeView
}
describe('host generation authority', () => {
  it.each(['view', 'backend'] as const)(
    'bounds %s responses by encoded JSON size',
    async source => {
      const access = new PluginHostAccess(() => true)
      let value: unknown = { ok: true }
      access.bind({ request: async () => value, retire: async () => undefined })
      const call = () =>
        source === 'view'
          ? access.view(view(), () => true, 'filesystem.readText', {})
          : access.backend(runtime).hostRequest('filesystem.readText', {})
      await expect(call()).resolves.toEqual({ ok: true })
      value = { content: String.fromCharCode(1).repeat(400_000) }
      await expect(call()).rejects.toThrow('host response')
      value = { recovered: true }
      await expect(call()).resolves.toEqual({ recovered: true })
    },
  )

  it('rejects previews before touching any target and rejects unpublished runtime', async () => {
    let published = false
    const access = new PluginHostAccess(() => published)
    const request = vi.fn(async () => null)
    access.bind({ request, retire: async () => undefined })
    await expect(access.backend(runtime).hostRequest('target.resolve', {})).rejects.toThrow(
      'no longer active',
    )
    published = true
    await expect(access.view(view(true), () => true, 'target.resolve', {})).rejects.toThrow(
      'Preview',
    )
    expect(request).not.toHaveBeenCalled()
  })
  it('fences an in-flight result after view close and retires only that view owner', async () => {
    const access = new PluginHostAccess(() => true)
    let done!: (value: unknown) => void
    const retire = vi.fn(async () => undefined)
    access.bind({
      request: () =>
        new Promise(resolve => {
          done = resolve
        }),
      retire,
    })
    let current = true
    const pending = access.view(view(), () => current, 'filesystem.readText', {})
    current = false
    await access.closeView('view')
    done('old')
    await expect(pending).rejects.toThrow('no longer active')
    expect(retire).toHaveBeenCalledExactlyOnceWith('view:view')
  })
  it('permanently retires a crashed backend generation', async () => {
    const access = new PluginHostAccess(() => true)
    access.bind({ request: async () => 'ok', retire: async () => undefined })
    const backend = access.backend(runtime)
    await expect(backend.hostRequest('target.resolve', {})).resolves.toBe('ok')
    await backend.hostClosed()
    await expect(backend.hostRequest('target.resolve', {})).rejects.toThrow('no longer active')
  })
})
