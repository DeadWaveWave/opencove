import { vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { registerPtyMountHandlers } from '../../../src/app/main/controlSurface/handlers/ptyMountHandlers'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import type { CreateAgentLaunchPlanCommand } from '../../../src/contexts/agent/application/ports/AgentProviderContribution'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { MultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

export const savedKey = 's1a-private-key-with spaces-"quotes"-$dollar'
export const cwd = process.cwd()
export const rootUri = pathToFileURL(cwd).href

export async function createLaunchWorker(options: {
  name: string
  fullAccess: boolean
  reuse: boolean
  profileId?: string
  remote?: boolean
  savedKey?: string
  assertActive?: () => void
}) {
  const state = createMinimalState(cwd, 'project', 'space')
  state.settings = {
    defaultProvider: 'codex',
    agentFullAccess: options.fullAccess,
    codexReuseRunningAppServer: options.reuse,
    defaultTerminalProfileId: options.profileId ?? null,
    agentEnvByProvider: {
      codex: [
        { id: 'key', key: 'S1A_TEST_API_KEY', value: options.savedKey ?? savedKey, enabled: true },
      ],
    },
  }
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(state)
  const plan = vi.fn(async (_input: CreateAgentLaunchPlanCommand) => ({
    command: 'fixture-agent',
    args: ['--model', 'fixture-model'],
    env: {},
    effectiveModel: 'fixture-model',
    launchMode: 'new' as const,
    resumeSessionId: null,
  }))
  const spawn = vi.fn(async (_input: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0]) => ({
    sessionId: `${options.name}-child-${spawn.mock.calls.length}`,
  }))
  const ptyRuntime = {
    spawnSession: spawn,
    registerRemoteSession: ({ remoteSessionId }: { remoteSessionId: string }) =>
      `proxy-${remoteSessionId}`,
    write: vi.fn(),
    kill: vi.fn(),
    resize: async () => ({ status: 'session_not_found' }),
    onData: () => () => {},
    onExit: () => () => {},
  } as unknown as MultiEndpointPtyRuntime
  const hub = new PtyStreamHub({ ptyRuntime, replayWindowMaxBytes: 64_000 })
  const surface = createControlSurface()
  const topology = {
    listMounts: async () => ({ mounts: [] }),
    resolveMountTarget: async () => ({
      mountId: 'mount',
      projectId: 'project',
      targetId: 'target',
      endpointId: options.remote ? 'remote' : 'local',
      rootPath: cwd,
      rootUri,
    }),
    resolveRemoteEndpointConnection: async () => ({
      baseUrl: 'http://worker.invalid',
      token: 'worker-bearer',
    }),
  } as unknown as WorkerTopologyStore
  const deps = {
    ...createReadyTerminalAdmissionDeps(),
    userDataPath: cwd,
    approvedWorkspaces: { isPathApproved: async () => true } as never,
    getPersistenceStore: async () => store,
    ptyRuntime,
    ptyStreamHub: hub,
    topology,
    agentProviderRegistry: new AgentProviderRegistry([
      {
        descriptor: {
          id: 'codex',
          displayName: 'fixture',
          documentationUrl: '',
          launch: { executable: 'fixture-agent', defaultArguments: [], defaultEnvironment: {} },
        },
        detector: { inspect: vi.fn() },
        launcher: { createLaunchPlan: plan },
      },
    ]),
  }
  registerSessionHandlers(surface, deps)
  registerSessionStreamingHandlers(surface, deps)
  registerPtyMountHandlers(surface, deps)
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
  const invoke = (
    caller: 'grant' | 'bearer' | 'cookie',
    request: Parameters<ControlSurface['invoke']>[1],
  ) => {
    const requestAuth: ControlSurfaceContext['requestAuth'] =
      caller === 'grant'
        ? { kind: 'session-grant', grant }
        : caller === 'bearer'
          ? { kind: 'bearer' }
          : { kind: 'cookie', webSessionGeneration: 0 }
    return surface.invoke({ ...base, requestAuth, assertActive: options.assertActive }, request)
  }
  return { invoke, plan, spawn, hub, store }
}
