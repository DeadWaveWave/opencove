import { vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { AgentLaunchSessionRegistrationOwner } from '../../../src/contexts/agent/application/services/AgentLaunchSessionRegistrationOwner'
import type { MultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

export const cwd = process.cwd()
export const rootUri = pathToFileURL(cwd).href
export async function createPromptWorker(options: { remote?: boolean; fullAccess: boolean }) {
  const store = createInMemoryPersistenceStore()
  const state = createMinimalState(cwd, 'project', 'space')
  state.settings = {
    defaultProvider: 'codex',
    agentFullAccess: options.fullAccess,
    codexReuseRunningAppServer: false,
  }
  await store.writeAppState(state)
  const owner = new AgentLaunchSessionRegistrationOwner(error => {
    throw error
  })
  const spawn = vi.fn(async (_input: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0]) => ({
    sessionId: `child-${spawn.mock.calls.length}`,
  }))
  const kill = vi.fn((sessionId: string) => owner.noteExit(sessionId))
  const runtime = {
    spawnSession: (input: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0]) =>
      owner.spawn({
        spawn: () => spawn(input),
        artifacts: input.launchArtifacts,
        onRegistered: () => {},
        retireExact: async id => {
          kill(id)
        },
      }),
    kill,
    write: vi.fn(),
    onData: () => () => {},
    onExit: () => () => {},
    registerRemoteSession: ({ remoteSessionId }: { remoteSessionId: string }) =>
      `home-${remoteSessionId}`,
  } as unknown as MultiEndpointPtyRuntime
  const hub = new PtyStreamHub({ ptyRuntime: runtime, replayWindowMaxBytes: 64_000 })
  const topology = {
    listEndpoints: async () => ({
      endpoints: [
        { endpointId: 'local', kind: 'local', displayName: 'Local' },
        { endpointId: 'remote', kind: 'remote_worker', displayName: 'Remote' },
      ],
    }),
    listMounts: async () => ({
      mounts: options.remote
        ? [
            {
              mountId: 'mount',
              projectId: 'project',
              targetId: 'target',
              endpointId: 'remote',
              rootPath: cwd,
              rootUri,
            },
          ]
        : [],
    }),
    resolveMountTarget: async () => ({
      mountId: 'mount',
      projectId: 'project',
      targetId: 'target',
      endpointId: options.remote ? 'remote' : 'local',
      rootPath: cwd,
      rootUri,
    }),
    resolveRemoteEndpointConnection: async () => ({
      baseUrl: 'http://fixture.invalid',
      token: 'worker-bearer',
    }),
  } as unknown as WorkerTopologyStore
  const surface = createControlSurface()
  const deps = {
    ...createReadyTerminalAdmissionDeps(),
    userDataPath: cwd,
    approvedWorkspaces: { isPathApproved: async () => true } as never,
    getPersistenceStore: async () => store,
    ptyRuntime: runtime,
    ptyStreamHub: hub,
    topology,
    agentProviderRegistry: new AgentProviderRegistry(
      createBuiltinAgentProviderContributions({ runtimePlatform: 'linux' }),
    ),
  }
  registerSessionHandlers(surface, deps)
  registerNodeControlHandlers(surface, deps)
  const { grant } = new SessionGrantRegistry(() => true).issue({
    projectId: 'project',
    spaceId: 'space',
    nodeId: 'caller',
    sessionId: 'caller-session',
  })
  const base = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 64_000,
  })
  const invoke = (request: Parameters<ControlSurface['invoke']>[1], trusted = false) =>
    surface.invoke(
      { ...base, requestAuth: trusted ? { kind: 'bearer' } : { kind: 'session-grant', grant } },
      request,
    )
  return {
    invoke,
    spawn,
    kill,
    store,
    hub,
    owner,
    dispose: async () => {
      owner.dispose()
      await Promise.all(spawn.mock.calls.map(([input]) => input.launchArtifacts?.dispose()))
    },
  }
}
