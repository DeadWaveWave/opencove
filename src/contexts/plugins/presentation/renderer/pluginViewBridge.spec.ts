import { createAppError } from '../../../../shared/errors/appError'
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
  it('acknowledges a real title only after its opening Worker accepts the lease-scoped report', async () => {
    const { send, post, title, invoke } = setup()
    let finish!: () => void
    invoke.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    send({
      type: 'request',
      id: 'title',
      operation: 'title',
      payload: { title: '  Planning  ', viewId: 'forged' },
    })
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      kind: 'command',
      id: 'plugin.view.setTitle',
      payload: { viewId: 'host-owned-view', title: 'Planning' },
    })
    expect(title).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(title).toHaveBeenCalledExactlyOnceWith('Planning')
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'result', id: 'title', value: null })
  })

  it('rejects failed title reports and ignores a late title acknowledgement after view disposal', async () => {
    const { send, post, title, invoke, dispose } = setup()
    invoke.mockRejectedValueOnce(new Error('View expired'))
    send({ type: 'request', id: 'failed', operation: 'title', payload: { title: 'Expired' } })
    await vi.waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(post.mock.calls[0][0]).toMatchObject({
      type: 'result',
      id: 'failed',
      error: expect.stringContaining('View expired'),
    })
    expect(title).not.toHaveBeenCalled()
    let finish!: () => void
    invoke.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    send({ type: 'request', id: 'late', operation: 'title', payload: { title: 'Late' } })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    dispose()
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(title).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledOnce()
  })

  it('serializes overlapping titles and cancels queued updates when the view closes', async () => {
    const { send, title, invoke, dispose } = setup()
    let finish!: () => void
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    send({ type: 'request', id: 'one', operation: 'title', payload: { title: 'One' } })
    send({ type: 'request', id: 'two', operation: 'title', payload: { title: 'Two' } })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    expect(title).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(title).toHaveBeenCalledTimes(2))
    expect(title.mock.calls).toEqual([['One'], ['Two']])
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    send({ type: 'request', id: 'three', operation: 'title', payload: { title: 'Three' } })
    send({ type: 'request', id: 'four', operation: 'title', payload: { title: 'Four' } })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
    dispose()
    finish()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(title).toHaveBeenCalledTimes(2)
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

it.each([
  ['preferences.get', 'query', 'plugin.view.preferences.get', {}],
  ['preferences.set', 'command', 'plugin.view.preferences.set', { key: 'compact', value: true }],
] as const)(
  'pins %s to the owning view and strips forged identities',
  async (operation, kind, id, payload) => {
    const { invoke, send, post } = setup()
    send({
      type: 'request',
      id: 'preferences',
      operation,
      payload: { ...payload, viewId: 'forged', pluginId: 'other' },
    })
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledExactlyOnceWith({
      kind,
      id,
      payload: { ...payload, viewId: 'host-owned-view' },
    })
  },
)

it('passes sanitized filesystem diagnostics to the iframe instead of debug messages', async () => {
  const { invoke, send, post } = setup()
  invoke.mockRejectedValueOnce(
    createAppError('filesystem.write_file_text_failed', {
      params: { reason: 'already_exists', token: 'must-not-escape' },
      debugMessage: 'EEXIST /private/path?token=must-not-escape',
      details: { authorization: 'must-not-escape' },
    }),
  )
  send({
    type: 'request',
    id: 'file',
    operation: 'host.request',
    payload: { operation: 'filesystem.writeText', payload: {} },
  })
  await vi.waitFor(() => expect(post).toHaveBeenCalledOnce())
  expect(post.mock.calls[0][0]).toEqual({
    channel: 'opencove-plugin-v1',
    type: 'result',
    id: 'file',
    error: 'Unable to save the file. The destination already exists.',
    errorDescriptor: {
      code: 'filesystem.write_file_text_failed',
      params: { reason: 'already_exists' },
    },
  })
})
