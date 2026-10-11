// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { PluginOperationSnapshot } from '../../../src/contexts/plugins/domain/pluginHostTypes'

function pty(name: string) {
  const data = new Set<(value: { sessionId: string; data: string }) => void>()
  const exits = new Set<(value: { sessionId: string; exitCode: number }) => void>()
  let count = 0
  const runtime: ControlSurfacePtyRuntime = {
    spawnSession: vi.fn(async () => ({ sessionId: `${name}-${++count}` })),
    write: () => undefined,
    resize: async input => ({
      sessionId: input.sessionId,
      operationId: 'test',
      status: 'accepted',
      changed: true,
      geometry: { cols: input.cols, rows: input.rows, revision: null },
      authority: null,
    }),
    kill: vi.fn(sessionId => exits.forEach(listener => listener({ sessionId, exitCode: 143 }))),
    onData: listener => {
      data.add(listener)
      return () => {
        data.delete(listener)
      }
    },
    onExit: listener => {
      exits.add(listener)
      return () => {
        exits.delete(listener)
      }
    },
  }
  return {
    runtime,
    output: (sessionId: string) =>
      data.forEach(listener => listener({ sessionId, data: `${name} progress\r\n` })),
    exit: (sessionId: string) => exits.forEach(listener => listener({ sessionId, exitCode: 0 })),
  }
}

describe('plugin target routing over two authenticated Workers', () => {
  it('routes file reads and operation lifecycle to the selected Space, never the home placeholder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-plugin-target-'))
    const localRoot = join(root, 'local-files'),
      remoteRoot = join(root, 'remote-files'),
      source = join(root, 'plugin')
    await Promise.all([localRoot, remoteRoot, source].map(path => mkdir(path)))
    await writeFile(join(localRoot, 'where.txt'), 'local file')
    await writeFile(join(remoteRoot, 'where.txt'), 'remote file')
    await writeFile(
      join(source, 'opencove.plugin.json'),
      JSON.stringify({
        apiVersion: 1,
        id: 'target-test',
        version: '1.0.0',
        displayName: 'Target',
        description: 'Target fixture',
        view: { entry: 'index.html' },
        preview: 'index.html',
      }),
    )
    await writeFile(join(source, 'index.html'), '<html><head></head><body>Target</body></html>')
    const store = createInMemoryPersistenceStore()
    const state = createMinimalState(localRoot, 'project', 'space')
    state.workspaces[0].spaces[0].directoryPath = remoteRoot
    await store.writeAppState(state)
    const localPty = pty('home'),
      remotePty = pty('remote')
    const localApproved = createApprovedWorkspaceStoreForPath(join(root, 'local-approved.json'))
    const remoteApproved = createApprovedWorkspaceStoreForPath(join(root, 'remote-approved.json'))
    await localApproved.registerRoot(localRoot)
    await remoteApproved.registerRoot(remoteRoot)
    const remote = createControlSurfaceHttpRuntime({
      userDataPath: join(root, 'remote-profile'),
      token: 'remote-token',
      approvedWorkspaces: remoteApproved,
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: remotePty.runtime,
    })
    const home = createControlSurfaceHttpRuntime({
      userDataPath: join(root, 'home-profile'),
      token: 'home-token',
      approvedWorkspaces: localApproved,
      createPersistenceStore: async () => store,
      ptyRuntime: localPty.runtime,
    })
    try {
      await Promise.all([remote.ready, home.ready])
      const listen = (runtime: typeof home) =>
        runtime.listen({
          hostname: '127.0.0.1',
          bindHostname: '127.0.0.1',
          port: 0,
          role: 'private',
          enableWebShell: false,
          webUiPasswordHash: null,
        })
      const remoteAddress = await listen(remote).ready,
        homeAddress = await listen(home).ready
      const call = async <T = Record<string, unknown>>(
        id: string,
        payload: unknown,
      ): Promise<T> => {
        const response = await invoke(`http://127.0.0.1:${homeAddress.port}`, 'home-token', {
          kind: 'command',
          id,
          payload,
        })
        const result = response.data as { ok: boolean; value: T; error?: unknown }
        if (!result.ok) {
          throw new Error(JSON.stringify(result.error))
        }
        return result.value
      }
      await call('mount.create', { projectId: 'project', endpointId: 'local', rootPath: localRoot })
      const registered = await call<{ endpoint: { endpointId: string } }>('endpoint.register', {
        hostname: '127.0.0.1',
        port: remoteAddress.port,
        token: 'remote-token',
        displayName: 'Remote',
      })
      const mount = await call<{ mount: { mountId: string } }>('mount.create', {
        projectId: 'project',
        endpointId: registered.endpoint.endpointId,
        rootPath: remoteRoot,
      })
      Object.assign(state.workspaces[0].spaces[0], { targetMountId: mount.mount.mountId })
      await store.writeAppState(state)
      await call('plugin.install', { directory: source })
      const view = await call<{ viewId: string }>('plugin.view.open', {
        pluginId: 'target-test',
        nodeId: 'node',
        workspaceId: 'project',
      })
      const host = <T = Record<string, unknown>>(operation: string, payload: unknown) =>
        call<T>('plugin.host.request', { viewId: view.viewId, operation, payload })
      const target = { projectId: 'project', spaceId: 'space' }
      expect(
        await host('filesystem.readText', { target: { projectId: 'project' }, path: 'where.txt' }),
      ).toMatchObject({ content: 'local file', target: { endpointId: 'local' } })
      expect(await host('filesystem.readText', { target, path: 'where.txt' })).toMatchObject({
        content: 'remote file',
        target: { endpointId: registered.endpoint.endpointId },
      })
      expect(await host('filesystem.readDirectory', { target })).toMatchObject({
        entries: [{ name: 'where.txt' }],
      })
      // The real local and remote filesystem envelopes keep machine-readable reasons.
      for (const selected of [{ projectId: 'project' }, target]) {
        const failures = [
          ['filesystem.readText', { path: 'missing.txt' }, 'filesystem.stat_failed', 'not_found'],
          [
            'filesystem.writeText',
            { path: 'where.txt', content: 'destroy', overwrite: false },
            'filesystem.write_file_text_failed',
            'already_exists',
          ],
          [
            'filesystem.mkdir',
            { path: 'where.txt' },
            'filesystem.create_directory_failed',
            'already_exists',
          ],
        ] as const
        for (const [operation, input, code, reason] of failures) {
          // eslint-disable-next-line no-await-in-loop -- Sequential error responses identify the selected route.
          const response = await invoke(`http://127.0.0.1:${homeAddress.port}`, 'home-token', {
            kind: 'command',
            id: 'plugin.host.request',
            payload: { viewId: view.viewId, operation, payload: { target: selected, ...input } },
          })
          expect(response.data).toMatchObject({ ok: false, error: { code, params: { reason } } })
          expect((response.data as { error: unknown }).error).toEqual({ code, params: { reason } })
        }
      }
      const watch = await host<{ watchId: string }>('filesystem.watch', { target })
      await host('filesystem.mkdir', { target, path: 'generated' })
      await host('filesystem.writeText', {
        target,
        path: 'generated/result.txt',
        content: 'remote write',
        overwrite: false,
      })
      expect(await readFile(join(remoteRoot, 'generated/result.txt'), 'utf8')).toBe('remote write')
      await expect(readFile(join(localRoot, 'generated/result.txt'), 'utf8')).rejects.toThrow()
      await expect(
        host('filesystem.writeText', {
          target,
          path: 'generated/result.txt',
          content: 'destroy',
          overwrite: false,
        }),
      ).rejects.toThrow('already_exists')
      expect(await readFile(join(remoteRoot, 'generated/result.txt'), 'utf8')).toBe('remote write')
      await expect(
        host('filesystem.delete', { target, path: 'generated', recursive: false }),
      ).rejects.toThrow('not_empty')
      await host('filesystem.rename', {
        target,
        path: 'generated/result.txt',
        newPath: 'generated/renamed.txt',
      })
      expect(
        await host('filesystem.stat', { target, path: 'generated/renamed.txt' }),
      ).toMatchObject({ stat: { kind: 'file' } })
      await new Promise(resolve => setTimeout(resolve, 1010))
      expect(await host('filesystem.readWatch', { watchId: watch.watchId })).toMatchObject({
        events: expect.arrayContaining([{ type: 'created', path: 'generated' }]),
        truncated: false,
      })
      await host('filesystem.delete', { target, path: 'generated', recursive: true })
      await new Promise(resolve => setTimeout(resolve, 1010))
      expect(await host('filesystem.readWatch', { watchId: watch.watchId })).toMatchObject({
        events: expect.arrayContaining([{ type: 'deleted', path: 'generated' }]),
      })
      await host('filesystem.unwatch', { watchId: watch.watchId })
      await expect(host('filesystem.readWatch', { watchId: watch.watchId })).rejects.toThrow(
        'unavailable',
      )
      await Promise.all(
        ['filesystem.writeText', 'filesystem.delete', 'filesystem.rename'].map(operation =>
          expect(host(operation, { target, path: '.' })).rejects.toThrow('working directory'),
        ),
      )
      await expect(
        host('filesystem.writeText', { target, path: 'where.txt', content: 'destroy' }),
      ).rejects.toThrow('overwrite')
      await expect(host('target.resolve', {})).rejects.toThrow('projectId')
      await expect(
        host('filesystem.readText', { target, path: '../local-files/where.txt' }),
      ).rejects.toThrow('cannot leave')
      const op = await host<PluginOperationSnapshot>('operations.start', {
        target,
        command: process.execPath,
        args: ['--version'],
      })
      await expect.poll(() => remotePty.runtime.spawnSession.mock?.calls.length ?? 0).toBe(1)
      expect(localPty.runtime.spawnSession).not.toHaveBeenCalled()
      expect(remotePty.runtime.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: remoteRoot, command: process.execPath }),
      )
      remotePty.output('remote-1')
      await expect
        .poll(
          async () =>
            (await host<PluginOperationSnapshot>('operations.get', { operationId: op.operationId }))
              .output,
        )
        .toContain('remote progress')
      remotePty.exit('remote-1')
      await expect
        .poll(
          async () =>
            (await host<PluginOperationSnapshot>('operations.get', { operationId: op.operationId }))
              .status,
        )
        .toBe('completed')
      const second = await host<PluginOperationSnapshot>('operations.start', {
        target,
        command: process.execPath,
      })
      await expect
        .poll(
          async () =>
            (
              await host<PluginOperationSnapshot>('operations.get', {
                operationId: second.operationId,
              })
            ).status,
        )
        .toBe('running')
      await host('operations.cancel', { operationId: second.operationId })
      await expect
        .poll(
          async () =>
            (
              await host<PluginOperationSnapshot>('operations.get', {
                operationId: second.operationId,
              })
            ).status,
        )
        .toBe('cancelled')
      expect(remotePty.runtime.kill).toHaveBeenCalledWith('remote-2')
      const preview = await call<{ viewId: string }>('plugin.view.open', {
        pluginId: 'target-test',
        nodeId: 'preview',
        preview: true,
      })
      await expect(
        call('plugin.host.request', {
          viewId: preview.viewId,
          operation: 'target.resolve',
          payload: target,
        }),
      ).rejects.toThrow('Preview')
      await remote.dispose()
      await expect(host('filesystem.readText', { target, path: 'where.txt' })).rejects.toThrow()
      expect(localPty.runtime.spawnSession).not.toHaveBeenCalled()
      await call('plugin.view.close', { viewId: view.viewId })
      await expect(host('target.resolve', target)).rejects.toThrow('expired or closed')
    } finally {
      await Promise.all([home.dispose(), remote.dispose()])
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
