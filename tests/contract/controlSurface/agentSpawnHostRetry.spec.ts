// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { registerPtyMountHandlers } from '../../../src/app/main/controlSurface/handlers/ptyMountHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { createHeadlessPtyRuntime } from '../../../src/app/worker/headlessPtyRuntime'
import { PtyHostTerminalProcessEngine } from '../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
import { TestPtyHostProcess } from '../../unit/platform/ptyHostSupervisor.testSupport'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

it.each(['plain', 'mounted'] as const)(
  'retains a lost replacement reply through the real %s terminal launch and admission composition',
  async route => {
    const store = createInMemoryPersistenceStore()
    const directory = tmpdir()
    const state = createMinimalState(directory, 'project', 'space')
    state.workspaces[0].nodes = [
      { id: 'root', kind: 'terminal', title: 'Caller', sessionId: 'caller' },
      { id: 'descendant', kind: 'terminal', title: 'Relaunch', sessionId: 'old' },
    ]
    state.workspaces[0].spaces[0].nodeIds = ['root', 'descendant']
    await store.commitCreatedNodeState!(state, {
      lineage: { nodeId: 'descendant', spawnedBy: 'root', rootNodeId: 'root', lineageDepth: 2 },
      expectedRevision: 0,
    })
    const hosts = ['initial', 'replacement', 'after-completion'].map(
      id => new TestPtyHostProcess(id),
    )
    const [initial, replacement] = hosts
    replacement.exitOnKill = false
    let sequence = 0
    const createProcess = vi.fn(() => {
      const host = hosts[createProcess.mock.calls.length - 1]
      host.on('postMessage', (request: { type: string; requestId: string }) => {
        if (request.type === 'shutdown') {
          queueMicrotask(() => host.emit('exit', 0))
        } else if (request.type === 'spawn') {
          if (host === initial) {
            queueMicrotask(() => host.emit('exit', 1))
          } else if (host !== replacement) {
            queueMicrotask(() =>
              host.emitHostMessage({
                type: 'response',
                requestType: 'spawn',
                requestId: request.requestId,
                ok: true,
                result: { sessionId: `session-${++sequence}` },
              }),
            )
          }
        }
      })
      queueMicrotask(() => host.emitReady())
      return host
    })
    const engine = new PtyHostTerminalProcessEngine({
      baseDir: directory,
      resolveEntryPath: () => '/fake/ptyHost.js',
      createProcess,
      spawnTimeoutMs: 10,
      reportIssue: () => {},
    })
    const headless = createHeadlessPtyRuntime({ processEngine: engine })
    const tracked = createAgentSpawnRuntime(headless)
    const managedClaude = createManagedClaudeLaunchRuntime({
      getPersistenceStore: async () => store,
      adoptionEnabled: () => false,
      hasRuntime: () => false,
      killExactRuntime: async id => engine.kill(id),
    })
    const { terminalSpawnAdmission } = createReadyTerminalAdmissionDeps()
    const runner = createCanvasSpawnRunner({
      managedClaude,
      terminalRuntimeAvailability: terminalSpawnAdmission,
      getPersistenceStore: async () => store,
    })
    const surface = createControlSurface({
      run: (...args) => tracked.observeRequests(() => runner(...args)),
    })
    const mount = {
      mountId: 'mount',
      projectId: 'project',
      endpointId: 'local',
      rootPath: directory,
      rootUri: toFileUri(directory),
    }
    const topology = {
      resolveMountTarget: async () => mount,
      listMounts: async () => ({ mounts: [] }),
      listEndpoints: async () => ({ endpoints: [{ endpointId: 'local', kind: 'local' }] }),
    } as never
    const deps = {
      topology,
      terminalSpawnAdmission,
      getPersistenceStore: async () => store,
      approvedWorkspaces: { isPathApproved: async () => true } as never,
      ptyRuntime: tracked.runtime,
      ptyStreamHub: { registerSessionMetadata: vi.fn() } as never,
    }
    registerSessionStreamingHandlers(surface, deps)
    registerPtyMountHandlers(surface, { ...deps, ptyRuntime: tracked.runtime as never })
    registerNodeControlHandlers(surface, {
      topology,
      getPersistenceStore: deps.getPersistenceStore,
      agentSpawnRuntime: tracked.port,
      killExactSession: id => engine.kill(id),
    })
    const context = createControlSurfaceHttpServerContext({
      enableWebShell: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 10,
    })
    const grant = new SessionGrantRegistry(() => true).issue({
      projectId: 'project',
      spaceId: 'space',
      nodeId: 'root',
      sessionId: 'caller',
    }).grant
    const create = () =>
      surface.invoke(
        { ...context, requestAuth: { kind: 'session-grant', grant } },
        {
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: 'space' },
            data: { command: 'echo child' },
          },
        },
      )
    try {
      const relaunch = await surface.invoke(
        { ...context, requestAuth: { kind: 'bearer' } },
        {
          kind: 'command',
          id: route === 'plain' ? 'pty.spawn' : 'pty.spawnInMount',
          payload: {
            canvasNodeId: 'descendant',
            command: process.execPath,
            args: [],
            cols: 80,
            rows: 24,
            ...(route === 'plain'
              ? { cwd: directory, workspaceId: 'project' }
              : { mountId: 'mount', cwdUri: toFileUri(directory) }),
          },
        },
      )
      expect(relaunch).toMatchObject({ ok: false })
      expect(createProcess).toHaveBeenCalledTimes(2)
      expect(tracked.port.snapshot().bindings).toMatchObject([
        { nodeId: 'descendant', state: 'unknown' },
      ])
      initial.emit('exit', 0)
      replacement.emitHostMessage({ type: 'exit', sessionId: 'unregistered', exitCode: 0 })
      for (let i = 0; i < 6; i++) {
        expect(await create()).toMatchObject({
          ok: false,
          error: {
            code: 'common.unavailable',
            details: { reason: 'spawn_accounting_unavailable' },
          },
        })
      }
      expect(createProcess).toHaveBeenCalledTimes(2)
      replacement.emit('exit', 0)
      await vi.waitFor(() => expect(tracked.port.snapshot().bindings).toEqual([]))
      expect(await create()).toMatchObject({
        ok: true,
        value: { node: { lineageDepth: 2, sessionId: 'session-1' } },
      })
    } finally {
      await headless.dispose()
      tracked.dispose()
      managedClaude.dispose()
    }
  },
)
