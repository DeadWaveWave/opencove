// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindPluginViewBridge } from './pluginViewBridge'
import type { PluginOpenViewResult } from '../../domain/pluginRuntimeTypes'

const view: PluginOpenViewResult = {
  viewId: 'host-owned-view',
  resourcePath: '/plugin-assets/lease/ui/index.html',
  revision: 'one',
  context: {
    pluginId: 'example',
    nodeId: 'node',
    workspaceId: null,
    directoryPath: null,
    preview: false,
  },
}
const disposers: Array<() => void> = []
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function setup(preview = false) {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const invoke = vi.fn().mockResolvedValue({ answer: 42 })
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { controlSurface: { invoke } },
  })
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const title = vi.fn()
  const restore = vi.fn()
  const dispose = bindPluginViewBridge({
    view: { ...view, context: { ...view.context, preview } },
    url: 'http://127.0.0.1:9012/plugin-assets/lease/ui/index.html',
    getFrame: () => frame,
    onTitleChange: title,
    onRestore: restore,
  })
  disposers.push(dispose)
  const send = (
    data: Record<string, unknown>,
    origin = 'http://127.0.0.1:9012',
    source: Window | null = frame.contentWindow,
  ) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        origin,
        data: { channel: 'opencove-plugin-v1', ...data },
      }),
    )
  }
  return { frame, invoke, post, title, restore, send, dispose }
}

describe('plugin view bridge authority and lifetime', () => {
  it('accepts only its own frame and pins all requests to the host-owned view', async () => {
    const { invoke, send, post } = setup()
    const request = {
      type: 'request',
      id: '1',
      operation: 'invoke',
      payload: {
        method: 'read',
        params: {},
        viewId: 'forged-view',
        pluginId: 'another-plugin',
      },
    }
    send(request, 'https://unexpected.example')
    send(request, 'http://127.0.0.1:9012', window)
    expect(invoke).not.toHaveBeenCalled()
    send(request)
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      kind: 'command',
      id: 'plugin.invoke',
      payload: { viewId: 'host-owned-view', method: 'read', params: {} },
    })
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'result', id: '1', value: { answer: 42 } })
  })

  it('sends theme and title updates only to its own view without reopening it', async () => {
    const { send, post, title, invoke } = setup(true)
    document.documentElement.dataset.coveTheme = 'light'
    send({ type: 'ready' })
    expect(post.mock.calls[0][0]).toMatchObject({
      type: 'init',
      context: { preview: true, theme: 'light' },
    })
    document.documentElement.dataset.coveTheme = 'dark'
    window.dispatchEvent(new Event('opencove-theme-changed'))
    expect(post.mock.calls[1][0]).toMatchObject({ type: 'theme', context: { theme: 'dark' } })
    send({ type: 'request', id: '2', operation: 'title', payload: { title: 'Preview title' } })
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(3))
    expect(title).toHaveBeenCalledExactlyOnceWith('Preview title')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('drops late replies and removes listeners after close', async () => {
    const { send, post, invoke, dispose } = setup()
    let finish!: (value: unknown) => void
    invoke.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    send({ type: 'request', id: '3', operation: 'storage.get', payload: { key: 'queue' } })
    expect(invoke).toHaveBeenCalledOnce()
    dispose()
    finish({ old: true })
    await Promise.resolve()
    await Promise.resolve()
    send({ type: 'ready' })
    window.dispatchEvent(new Event('opencove-theme-changed'))
    expect(post).not.toHaveBeenCalled()
  })
  it('accepts a restore only once from the owned frame and retires its old bridge', () => {
    const { send, restore, invoke, post, dispose } = setup()
    send({ type: 'restore' }, 'https://another.example')
    send({ type: 'restore' }, 'http://127.0.0.1:9012', window)
    send({ type: 'restore', channel: 'another-channel' })
    expect(restore).not.toHaveBeenCalled()
    send({ type: 'restore' })
    send({ type: 'restore' })
    send({ type: 'ready' })
    send({ type: 'request', id: 'old', operation: 'invoke', payload: { method: 'read' } })
    window.dispatchEvent(new Event('opencove-theme-changed'))
    expect(restore).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    dispose()
    send({ type: 'restore' })
    expect(restore).toHaveBeenCalledOnce()
  })
})
