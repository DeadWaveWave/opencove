import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'
// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
import type { CreateNodeResult, GetNodeResult } from '../../../src/shared/contracts/dto'
import type { PluginObservationBatch } from '../../../src/contexts/plugins/domain/pluginCanvasTypes'

function pty(name: string) {
  const data = new Set<(value: { sessionId: string; data: string }) => void>()
  const exits = new Set<(value: { sessionId: string; exitCode: number }) => void>()
  let count = 0
  const runtime: ControlSurfacePtyRuntime = {
    spawnSession: vi.fn(async () => ({ sessionId: `${name}-${++count}` })),
    write: vi.fn(),
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

describe('plugin canvas routing over two authenticated Workers', () => {
  it('creates durable nodes on explicit local and remote targets and routes exact session controls', async () => {
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
    const writeState = store.writeAppState
    store.writeAppState = async (next, options) => {
      const revision = await store.readAppStateRevision()
      if (options?.expectedRevision !== undefined && revision !== options.expectedRevision) {
        return {
          ok: false,
          reason: 'unknown',
          error: createAppErrorDescriptor('persistence.invalid_state', {
            debugMessage: `App state revision conflict (expected=${options.expectedRevision}, current=${revision}).`,
          }),
        }
      }
      return writeState(next, options)
    }
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
      await expect(host('terminals.create', { target: {} })).rejects.toThrow('projectId')
      const sub = await host<{ subscriptionId: string }>('events.subscribe', {
        projectId: 'project',
      })
      const note = await host<CreateNodeResult>('nodes.create', {
        target: { projectId: 'project' },
        kind: 'note',
        title: 'Project note',
        data: { text: 'Hello' },
      })
      expect(note).toMatchObject({ projectId: 'project', spaceId: null, node: { kind: 'note' } })
      await host('nodes.update', {
        nodeId: note.node.id,
        kind: 'note',
        title: 'Edited',
        data: { text: 'Changed' },
      })
      expect(await host('nodes.get', { nodeId: note.node.id })).toMatchObject({
        node: { title: 'Edited', data: { text: 'Changed' } },
      })
      const spawnLocal = vi.mocked(localPty.runtime.spawnSession)
      const originalSpawn = spawnLocal.getMockImplementation()!
      spawnLocal.mockImplementationOnce(async input => {
        const snapshot = structuredClone(await store.readAppState()) as typeof state
        snapshot.workspaces[0].viewport = { x: 444, y: 222, zoom: 0.75 }
        snapshot.settings = { language: 'zh-CN', uiTheme: 'pixel-light' }
        const edited = snapshot.workspaces[0].nodes.find(item => item.id === note.node.id)!
        edited.task = { text: 'Edited in Web UI while terminal starts' }
        await call('sync.writeState', {
          state: snapshot,
          baseRevision: await store.readAppStateRevision(),
        })
        return originalSpawn(input)
      })
      const local = await host<CreateNodeResult>('terminals.create', {
        target: { projectId: 'project' },
        title: 'Local terminal',
      })
      const afterCreate = (await store.readAppState()) as typeof state
      expect(afterCreate.workspaces[0].viewport).toEqual({ x: 444, y: 222, zoom: 0.75 })
      expect(afterCreate.settings).toMatchObject({ language: 'zh-CN', uiTheme: 'pixel-light' })
      expect(
        afterCreate.workspaces[0].nodes.find(item => item.id === note.node.id)?.task,
      ).toMatchObject({ text: 'Edited in Web UI while terminal starts' })
      expect(spawnLocal).toHaveBeenCalledTimes(1)
      expect(localPty.runtime.kill).not.toHaveBeenCalled()
      const remoteNode = await host<CreateNodeResult>('terminals.create', {
        target,
        title: 'Remote terminal',
      })
      expect(local.node.sessionId).toBe('home-1')
      expect(remotePty.runtime.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: remoteRoot }),
      )
      expect(localPty.runtime.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: localRoot }),
      )
      expect(remoteNode.spaceId).toBe('space')
      await host('terminals.write', { nodeId: remoteNode.node.id, data: 'echo remote\n' })
      await expect.poll(() => remotePty.runtime.write.mock?.calls.length ?? 0).toBe(1)
      expect(remotePty.runtime.write).toHaveBeenCalledWith('remote-1', 'echo remote\n')
      expect(localPty.runtime.write).not.toHaveBeenCalled()
      await host('terminals.interrupt', { nodeId: remoteNode.node.id })
      await expect.poll(() => remotePty.runtime.write.mock?.calls.length ?? 0).toBe(2)
      expect(remotePty.runtime.write).toHaveBeenLastCalledWith('remote-1', '\u0003')
      remotePty.output('remote-1')
      await expect
        .poll(
          async () =>
            (await host<{ output: string }>('terminals.read', { nodeId: remoteNode.node.id }))
              .output,
        )
        .toContain('remote progress')
      await expect(host('agents.get', { nodeId: remoteNode.node.id })).rejects.toThrow(
        'Expected an agent',
      )
      await expect(
        host('terminals.create', { target, command: 'echo unsafe-default-shell' }),
      ).rejects.toThrow('explicit target shell')
      const agent = await host<CreateNodeResult>('agents.launch', {
        target,
        prompt: 'Inspect the project',
        provider: 'codex',
      })
      expect(agent.node).toMatchObject({
        kind: 'agent',
        data: { provider: 'codex', executionDirectory: remoteRoot },
      })
      expect(remotePty.runtime.spawnSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ cwd: remoteRoot }),
      )
      expect(await host('agents.get', { nodeId: agent.node.id })).toMatchObject({
        node: { id: agent.node.id },
        session: { status: 'running' },
      })
      await host('nodes.focus', { nodeId: note.node.id })
      await expect
        .poll(
          async () =>
            (await host<PluginObservationBatch>('events.poll', sub)).changes.filter(
              change => change.type === 'node',
            ).length,
        )
        .toBeGreaterThan(0)
      await host('terminals.stop', { nodeId: remoteNode.node.id })
      await expect.poll(() => remotePty.runtime.kill.mock?.calls.length ?? 0).toBe(1)
      expect(await host('nodes.get', { nodeId: remoteNode.node.id })).toMatchObject({
        node: { id: remoteNode.node.id },
      })
      const saved = await store.readAppState()
      if (!saved) {
        throw new Error('Expected persisted state')
      }
      const project = saved.workspaces[0]
      const originalMount = project.spaces[0].targetMountId
      project.spaces[0].targetMountId = 'disappeared-mount'
      await store.writeAppState(saved)
      const spawnCount = remotePty.runtime.spawnSession.mock?.calls.length
      await expect(host('terminals.create', { target })).rejects.toThrow()
      expect(remotePty.runtime.spawnSession.mock?.calls.length).toBe(spawnCount)
      expect(localPty.runtime.spawnSession).toHaveBeenCalledTimes(1)
      project.spaces[0].targetMountId = originalMount
      const template = project.nodes.find(item => item.id === note.node.id)!
      project.nodes.push({
        ...template,
        id: 'persisted-plugin',
        kind: 'plugin',
        task: { pluginId: 'target-test', schemaVersion: 1 },
      })
      project.collapsedNodeIds = ['persisted-plugin']
      await store.writeAppState(saved)
      const nodeView = await call<{ viewId: string }>('plugin.view.open', {
        pluginId: 'target-test',
        nodeId: 'persisted-plugin',
        workspaceId: 'project',
      })
      expect(await host('nodes.get', { nodeId: 'persisted-plugin' })).toMatchObject({
        node: { kind: 'plugin' },
      })
      await host('nodes.focus', { nodeId: 'persisted-plugin' })
      await host('nodes.close', { nodeId: 'persisted-plugin' })
      expect((await store.readAppState())?.workspaces[0].collapsedNodeIds).toEqual([])
      await expect(
        call('plugin.host.request', {
          viewId: nodeView.viewId,
          operation: 'nodes.list',
          payload: { projectId: 'project' },
        }),
      ).rejects.toThrow('expired or closed')
      await host('nodes.close', { nodeId: note.node.id })
      await expect(host('nodes.get', { nodeId: note.node.id })).rejects.toThrow()
      const preview = await call<{ viewId: string }>('plugin.view.open', {
        pluginId: 'target-test',
        nodeId: 'preview',
        preview: true,
      })
      await expect(
        call('plugin.host.request', {
          viewId: preview.viewId,
          operation: 'nodes.list',
          payload: { projectId: 'project' },
        }),
      ).rejects.toThrow('Preview')
      await call('plugin.view.close', { viewId: view.viewId })
      await expect(host('events.poll', sub)).rejects.toThrow('expired or closed')
      // Durable node sessions belong to the canvas; closing the requesting view cannot kill them.
      expect(localPty.runtime.kill).not.toHaveBeenCalled()
      const result = await invoke(`http://127.0.0.1:${homeAddress.port}`, 'home-token', {
        kind: 'query',
        id: 'node.get',
        payload: { nodeId: local.node.id },
      })
      expect((result.data as { value: GetNodeResult }).value.node.id).toBe(local.node.id)
    } finally {
      await Promise.all([home.dispose(), remote.dispose()])
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
