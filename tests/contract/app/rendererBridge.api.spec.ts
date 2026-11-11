import { beforeAll, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import type { OpenCoveBridgeApi } from '../../../src/shared/contracts/rendererBridge'
import type { OpenCoveApi } from '../../../src/app/preload/api'
import { createDesktopOpenCoveApi } from '../../../src/app/renderer/bootstrap/installDesktopOpenCoveApi'
import { createRendererBridge } from '../../../src/app/preload/rendererBridge'
const mock = vi.hoisted(() => ({
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  send: vi.fn(),
  expose: vi.fn(),
  invoke: vi.fn(async () => ({ __opencoveIpcEnvelope: true, ok: true, value: null })),
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mock.expose },
  webUtils: { getPathForFile: (file: File) => file.name },
  ipcRenderer: {
    invoke: mock.invoke,
    send: mock.send,
    on: (name: string, fn: (...args: unknown[]) => void) => {
      const set = mock.listeners.get(name) ?? new Set()
      set.add(fn)
      mock.listeners.set(name, set)
    },
    removeListener: (name: string, fn: (...args: unknown[]) => void) =>
      mock.listeners.get(name)?.delete(fn),
  },
}))
function emit(name: string, payload: unknown) {
  for (const fn of mock.listeners.get(name) ?? []) {
    fn({}, payload)
  }
}
let api: OpenCoveApi
beforeAll(async () => {
  Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  await import('../../../src/app/preload/index')
  const bridge = mock.expose.mock.calls[0][1] as OpenCoveBridgeApi<OpenCoveApi>
  expect(mock.expose.mock.calls[0][0]).toBe('__opencoveBridge')
  api = createDesktopOpenCoveApi(bridge)
})
it('covers every callable in the real public API surface with stable symmetric wrappers', () => {
  const bridge = mock.expose.mock.calls[0][1] as object
  function compare(source: object, result: object) {
    expect(Object.keys(result)).toEqual(Object.keys(source))
    for (const [key, value] of Object.entries(source)) {
      const actual = (result as Record<string, unknown>)[key]
      expect(typeof actual).toBe(typeof value)
      if (typeof value === 'function') {
        expect(actual).not.toBe(value)
      } else if (value && typeof value === 'object' && key !== 'meta') {
        compare(value, actual as object)
      }
    }
  }
  compare(bridge, api)
  compare(api, createRendererBridge(api))
})
it('passes a real File to the synchronous path helper', () => {
  expect(api.filesystem.getPathForFile(new File(['x'], 'input.txt'))).toBe('input.txt')
})
it.each(['state', 'metadata'] as const)(
  'replays PTY %s synchronously, in order, then stops after unsubscribe',
  kind => {
    const channel = kind === 'state' ? IPC_CHANNELS.ptyState : IPC_CHANNELS.ptySessionMetadata
    const subscribe = kind === 'state' ? api.pty.onState : api.pty.onMetadata
    const first =
      kind === 'state'
        ? { sessionId: `replay-${kind}`, state: 'running', source: 'session_file' }
        : {
            sessionId: `replay-${kind}`,
            resumeSessionId: 'conversation',
            agentProvider: 'claude-code',
            profileId: null,
            runtimeKind: 'posix',
          }
    emit(channel, first)
    const calls: unknown[] = []
    const unsubscribe = subscribe(((payload: unknown) => calls.push(payload)) as never)
    expect(calls).toMatchObject([first])
    const second = { ...first, state: 'idle' }
    emit(channel, second)
    expect(calls).toMatchObject([first, second])
    expect(unsubscribe()).toBeUndefined()
    emit(channel, { ...first, state: 'exited' })
    expect(calls).toHaveLength(2)
  },
)
it('acknowledges persistence flush only after the callback Promise settles', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const callback = vi.fn(() => held)
  const unsubscribe = api.lifecycle.onRequestPersistFlush(callback)
  emit(IPC_CHANNELS.appRequestPersistFlush, { requestId: 'flush' })
  await Promise.resolve()
  expect(callback).toHaveBeenCalledTimes(1)
  expect(mock.send).not.toHaveBeenCalledWith(IPC_CHANNELS.appPersistFlushComplete, {
    requestId: 'flush',
  })
  release()
  await vi.waitFor(() =>
    expect(mock.send).toHaveBeenCalledWith(IPC_CHANNELS.appPersistFlushComplete, {
      requestId: 'flush',
    }),
  )
  unsubscribe()
  emit(IPC_CHANNELS.appRequestPersistFlush, { requestId: 'after' })
  await Promise.resolve()
  expect(callback).toHaveBeenCalledTimes(1)
})
it('invokes every callable leaf once through both adapters without traversing its success payload', () => {
  const spies: Array<{ path: string[]; call: ReturnType<typeof vi.fn> }> = []
  const payload = new Uint8Array([1, 255])
  function fixture(source: object, path: string[] = []): object {
    const namespace: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'function') {
        const call = vi.fn(function (this: object, ...args: unknown[]) {
          expect(this).toBe(namespace)
          expect(args).toEqual([payload])
          expect(args[0]).toBe(payload)
          return payload
        })
        namespace[key] = call
        spies.push({ path: [...path, key], call })
      } else {
        namespace[key] =
          key === 'meta' || !value || typeof value !== 'object'
            ? value
            : fixture(value, [...path, key])
      }
    }
    return namespace
  }
  const facade = createDesktopOpenCoveApi(createRendererBridge(fixture(api) as OpenCoveApi))
  for (const { path, call } of spies) {
    let leaf: unknown = facade
    for (const key of path) {
      leaf = (leaf as Record<string, unknown>)[key]
    }
    expect((leaf as (arg: unknown) => unknown)(payload)).toBe(payload)
    expect(call).toHaveBeenCalledTimes(1)
  }
  expect(spies.length).toBeGreaterThan(100)
})
it.each([
  {},
  { __opencoveIpcEnvelope: true, ok: true },
  {
    __opencoveIpcEnvelope: true,
    ok: false,
    error: { code: 'future.code', debugMessage: 'SECRET' },
  },
])('does not convert malformed Main replies to an application rejection', async response => {
  mock.invoke.mockResolvedValueOnce(response as never)
  const before = mock.invoke.mock.calls.length
  const error = await api.persistence.writeAppState({} as never).catch(caught => caught)
  expect(error.name).toBe('RendererTransportError')
  expect(error.message).not.toContain('SECRET')
  expect(mock.invoke.mock.calls.length - before).toBe(1)
})
it('sanitizes a rejected IPC transport before the context bridge', async () => {
  mock.invoke.mockRejectedValueOnce(new Error('SECRET'))
  await expect(api.persistence.writeAppState({} as never)).rejects.toMatchObject({
    name: 'RendererTransportError',
  })
})
