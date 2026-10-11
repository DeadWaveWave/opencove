import { createAppError } from '../../../../src/shared/errors/appError'
// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodePluginBackend } from '../../../../src/contexts/plugins/infrastructure/NodePluginBackend'
import { PluginBackendHostClient } from '../../../../src/contexts/plugins/infrastructure/PluginBackendHostClient'
import { PluginBackendHostRequests } from '../../../../src/contexts/plugins/infrastructure/PluginBackendHostRequests'
import type {
  PluginBackend,
  PluginSnapshot,
} from '../../../../src/contexts/plugins/application/PluginRuntimePorts'
import { writePluginHostTestFixture } from './pluginHostTestFixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) {
    // eslint-disable-next-line no-await-in-loop -- Dispose child runtimes before deleting their temporary directories.
    await cleanup()
  }
})

async function backendFixture(
  hostRequest?: (operation: string, payload: unknown) => Promise<unknown>,
) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-host-rpc-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(
    join(root, 'main.mjs'),
    `
    export function activate({host}) {
      let hangingDispose = false;
      return { async runCommand(id, params) {
        if (id === 'crash') process.exit(7);
        if (id === 'disconnect') { hangingDispose = true; setInterval(() => {}, 1000); process.disconnect(); }
        if (id === 'inspect') return host.target.resolve(params);
        if (id === 'list') return host.target.list();
        if (id === 'read-error') {
          try { await host.filesystem.readText(params); }
          catch (error) { return { code: error.code, params: error.params, message: error.message, hasDebug: 'debugMessage' in error, hasDetails: 'details' in error }; }
        }
        if (id === 'read') return host.filesystem.readText(params);
        if (id === 'write') return host.filesystem.writeText(params);
        if (id === 'events') return host.events.subscribe(params);
        if (id === 'launch') return host.agents.launch(params);
        if (id === 'start') return host.operations.start(params);
        throw new Error('Unknown command');
      }, dispose() { if (hangingDispose) return new Promise(() => {}); }};
    }
  `,
  )
  const snapshot: PluginSnapshot = {
    directory: root,
    sourceDirectory: root,
    revision: 'one',
    enabled: true,
    package: {
      apiVersion: 1,
      id: 'host-rpc',
      version: '1.0.0',
      displayName: 'Host RPC',
      description: 'Tests real child host requests',
      main: 'main.mjs',
      contributes: {
        commands: [
          'list',
          'inspect',
          'read',
          'read-error',
          'write',
          'events',
          'launch',
          'start',
          'crash',
          'disconnect',
        ].map(id => ({
          id,
          title: id,
          description: id,
          target: 'plugin' as const,
        })),
      },
    },
  }
  const closed = vi.fn(async () => undefined)
  const backend = await new NodePluginBackend(await writePluginHostTestFixture(root)).start(
    snapshot,
    {
      dataDirectory: join(root, 'data'),
      log: () => {},
      unavailable: () => {},
      hostRequest,
      hostClosed: closed,
    },
  )
  cleanups.push(() => backend.dispose())
  return { backend, closed }
}

function run(backend: PluginBackend, id: string, params: unknown) {
  return backend.runCommand!(id, params, { pluginId: 'host-rpc' })
}

describe('backend host capabilities', () => {
  it('routes a no-window command through real child IPC, preserving explicit target and literal arguments', async () => {
    const request = vi.fn(async (operation, payload) => ({ operation, payload }))
    const { backend } = await backendFixture(request)
    expect(await run(backend, 'list', null)).toEqual({ operation: 'target.list', payload: {} })
    const target = { projectId: 'project-a', spaceId: 'remote-space' }
    expect(await run(backend, 'inspect', target)).toEqual({
      operation: 'target.resolve',
      payload: target,
    })
    const input = { target, command: 'tool', args: ['path with spaces', '$HOME', '`literal`'] }
    expect(await run(backend, 'start', input)).toEqual({
      operation: 'operations.start',
      payload: input,
    })
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('returns target errors and never silently falls back to Node filesystem access', async () => {
    const { backend } = await backendFixture(async () => {
      throw new Error('Target is offline')
    })
    await expect(
      run(backend, 'read', { target: { projectId: 'remote' }, path: 'README.md' }),
    ).rejects.toThrow('Target is offline')
    const unavailable = await backendFixture()
    await expect(run(unavailable.backend, 'inspect', { projectId: 'a' })).rejects.toThrow(
      'host capabilities are unavailable',
    )
  })

  it('exposes the same expanded host groups to a real backend and carries large UTF-8 writes intact', async () => {
    const request = vi.fn(async (operation, payload) => ({ operation, payload }))
    const { backend } = await backendFixture(request)
    const input = {
      target: { projectId: 'p' },
      path: 'notes.txt',
      content: '界'.repeat(30_000),
      overwrite: false,
    }
    expect(await run(backend, 'write', input)).toEqual({
      operation: 'filesystem.writeText',
      payload: input,
    })
    expect(await run(backend, 'events', { projectId: 'p', types: ['node'] })).toEqual({
      operation: 'events.subscribe',
      payload: { projectId: 'p', types: ['node'] },
    })
    expect(await run(backend, 'launch', { target: { projectId: 'p' }, prompt: 'Check' })).toEqual({
      operation: 'agents.launch',
      payload: { target: { projectId: 'p' }, prompt: 'Check' },
    })
  })

  it('retires host-owned work exactly once on crash and subsequent disposal', async () => {
    const { backend, closed } = await backendFixture(async () => null)
    await expect(run(backend, 'crash', null)).rejects.toThrow(/exited|disconnected/)
    await backend.dispose()
    await backend.dispose()
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('retires work on IPC disconnect even when the live child refuses to dispose', async () => {
    const { backend, closed } = await backendFixture(async () => null)
    await expect(run(backend, 'disconnect', null)).rejects.toThrow('disconnected')
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    await backend.dispose()
    expect(closed).toHaveBeenCalledTimes(1)
  })
})

describe('host RPC lifecycle and bounds', () => {
  it('retires a generation when host IO never settles, without admitting more work', async () => {
    vi.useFakeTimers()
    const request = vi.fn(() => new Promise(() => {}))
    const closed = vi.fn()
    const unavailable = vi.fn()
    const owner = new PluginBackendHostRequests({
      request,
      closed,
      unavailable,
      send: () => {},
      log: () => {},
      timeoutMs: 50,
    })
    const message = {
      type: 'host-request',
      requestId: '1',
      operation: 'target.resolve',
      payload: {},
    }
    owner.receive(message)
    await vi.advanceTimersByTimeAsync(50)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(unavailable).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('timed out') }),
    )
    owner.receive({ ...message, requestId: '2' })
    expect(request).toHaveBeenCalledTimes(1)
    await owner.close()
  })
  it('ignores duplicate in-flight IDs and suppresses responses after its generation closes', async () => {
    let resolve!: (value: unknown) => void
    const request = vi.fn(
      () =>
        new Promise<unknown>(accept => {
          resolve = accept
        }),
    )
    const send = vi.fn()
    const closed = vi.fn()
    const owner = new PluginBackendHostRequests({ request, send, closed, log: () => {} })
    const message = {
      type: 'host-request',
      requestId: '1',
      operation: 'target.resolve',
      payload: { projectId: 'a' },
    }
    owner.receive(message)
    owner.receive(message)
    expect(request).toHaveBeenCalledTimes(1)
    await owner.close()
    owner.receive({ ...message, requestId: '2' })
    resolve({ projectId: 'a' })
    await Promise.resolve()
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    await owner.close()
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized requests before dispatch and bounds response bytes', async () => {
    const send = vi.fn()
    const request = vi.fn(async () => 'x'.repeat(2 * 1024 * 1024))
    const owner = new PluginBackendHostRequests({ request, send, log: () => {} })
    owner.receive({
      type: 'host-request',
      requestId: '1',
      operation: 'x',
      payload: 'x'.repeat(2 * 1024 * 1024),
    })
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId: '1', ok: false })),
    )
    expect(request).not.toHaveBeenCalled()
    owner.receive({ type: 'host-request', requestId: '2', operation: 'x', payload: null })
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId: '2', ok: false })),
    )
    await owner.close()
  })

  it('bounds pending requests and rejects timeouts without replaying', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const client = new PluginBackendHostClient(send, 50)
    const result = client.api.target.resolve({ projectId: 'a' })
    const rejected = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    expect(send).toHaveBeenCalledTimes(1)
    client.receive({ type: 'host-response', requestId: '1', ok: true, value: 'late' })
    const pending = Array.from({ length: 128 }, () =>
      client.api.target.resolve({ projectId: 'a' }).catch(error => error.message),
    )
    await expect(client.api.target.resolve({ projectId: 'a' })).rejects.toThrow('Too many pending')
    client.close()
    expect(await Promise.all(pending)).toEqual(
      Array(128).fill('OpenCove plugin host connection closed.'),
    )
    await expect(client.api.operations.start({})).rejects.toThrow('connection closed')
  })
})

it('preserves sanitized filesystem code/reason through real backend child IPC', async () => {
  const { backend } = await backendFixture(async () => {
    throw createAppError('filesystem.stat_failed', {
      params: { reason: 'not_found', token: 'must-not-escape' },
      debugMessage: 'ENOENT /private/path?token=must-not-escape',
      details: { authorization: 'must-not-escape' },
    })
  })
  expect(await run(backend, 'read-error', { target: { projectId: 'p' }, path: 'missing' })).toEqual(
    {
      code: 'filesystem.stat_failed',
      params: { reason: 'not_found' },
      message: 'Unable to read file details. The file or folder does not exist.',
      hasDebug: false,
      hasDetails: false,
    },
  )
})
