import { vi } from 'vitest'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import {
  createPersistenceStore,
  type PersistenceStore,
} from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { resolveCanvasSpawnIdentity } from '../../../src/app/main/controlSurface/resolveCanvasSpawnIdentity'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { registerPtyMountHandlers } from '../../../src/app/main/controlSurface/handlers/ptyMountHandlers'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { mountListOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/mount'
import { createAppError } from '../../../src/shared/errors/appError'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { ControlSurfaceInvokeRequest } from '../../../src/shared/contracts/controlSurface'
import type { NodeWorkerBinding } from '../../../src/shared/types/nodeWorkerBinding'
import type { TerminalAgentActivityEnvironmentService } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from '../../unit/contexts/controlSurfaceTestTerminalAvailability'

export const routes: {
  name: string
  binding: NodeWorkerBinding | null
  inheritedMount?: boolean
}[] = [
  { name: 'inherited', binding: null },
  { name: 'inherited mount', binding: null, inheritedMount: true },
  { name: 'local', binding: { endpointId: 'local', mountId: null } },
  { name: 'mount', binding: { endpointId: 'local', mountId: 'mount' } },
]
export const operations = [
  'launch',
  'relaunch',
  'switch',
  'prepareResume',
  'prepareBlank',
  'prepareStoppedFallback',
  'prepareFailedResumeFallback',
] as const
export type Operation = (typeof operations)[number]
export const tuple = { resumeSessionId: 'initial-conversation', resumeSessionIdVerified: true }
export const directory = '/repo/project'
export async function snapshotFixture(
  dbPath: string,
  route: NodeWorkerBinding | null,
  owned: boolean,
  operation: Operation,
  inheritedMount = false,
  preSettled = false,
  options: {
    terminalAgentActivity?: TerminalAgentActivityEnvironmentService
    adoptionEnabled?: boolean
    wrapStore?: (store: PersistenceStore) => Promise<PersistenceStore>
    beforeIdentity?: () => Promise<void>
  } = {},
) {
  const store = await createPersistenceStore({ dbPath, strictRecovery: true })
  const blank = operation === 'prepareBlank'
  const initial = normalizePersistedAppState({
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            sessionId: 'old-runtime',
            title: 'Claude',
            position: { x: 1, y: 2 },
            width: 600,
            height: 400,
            status: operation === 'prepareStoppedFallback' ? 'stopped' : 'standby',
            startedAt: null,
            workerBinding: route,
            executionDirectory: directory,
            expectedDirectory: directory,
            agent: {
              provider: 'claude-code',
              prompt: blank ? '' : 'fixture',
              model: null,
              executionDirectory: directory,
              expectedDirectory: directory,
              directoryMode: 'custom',
              customDirectory: directory,
              shouldCreateDirectory: false,
              ...(blank ? { resumeSessionId: null, resumeSessionIdVerified: false } : tuple),
            },
          },
        ],
        spaces:
          route?.mountId || inheritedMount
            ? [
                {
                  id: 'space',
                  name: 'Space',
                  directoryPath: directory,
                  targetMountId: 'mount',
                  nodeIds: ['agent'],
                },
              ]
            : [],
      },
    ],
  })!
  await store.writeAppState(initial)
  if (owned) {
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'initial',
      runtimeSessionId: 'old-runtime',
      tuple,
    })
  }
  if (preSettled) {
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'pre-settled',
      runtimeSessionId: null,
      tuple,
    })
  }
  const initialRevision = await store.readAppStateRevision()
  const persistence = options.wrapStore ? await options.wrapStore(store) : store
  const getPersistenceStore = async () => persistence
  const publications: { nodeId: string; activationId: string; revision: number }[] = []
  const results: { id: string; value: unknown }[] = []
  const alive = new Set<string>()
  const inactive = new Set<string>()
  const exits = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const kill = (sessionId: string) => {
    alive.delete(sessionId)
    exits.forEach(emit => emit({ sessionId, exitCode: 0 }))
  }
  let sequence = 0
  const spawn = vi.fn(async (input: { agentProvider?: string }) => {
    if (operation === 'prepareFailedResumeFallback' && input.agentProvider) {
      throw new Error('fixture resume failed')
    }
    const sessionId = `runtime-${++sequence}`
    alive.add(sessionId)
    return { sessionId }
  })
  const spawnRuntime = createAgentSpawnRuntime({
    spawnSession: spawn,
    kill,
    write: () => {},
    resize: async () => ({ status: 'session_not_found' }) as never,
    onData: () => () => {},
    onExit: emit => {
      exits.add(emit)
      return () => {
        exits.delete(emit)
      }
    },
  })
  const runtime = createManagedClaudeLaunchRuntime({
    getPersistenceStore,
    adoptionEnabled: () => options.adoptionEnabled ?? true,
    publishCommittedActivation: event => {
      publications.push(event)
    },
    hasRuntime: id => alive.has(id),
    killExactRuntime: kill,
  })
  await runtime.ready()
  const admission = createReadyTerminalAdmissionDeps()
  const canvasSpawnRunner = createCanvasSpawnRunner({
    managedClaude: runtime,
    terminalRuntimeAvailability: admission.terminalSpawnAdmission,
    getPersistenceStore,
    resolveIdentity: async (...args) => {
      await options.beforeIdentity?.()
      return resolveCanvasSpawnIdentity(...args)
    },
  })
  const surface = createControlSurface({
    run: (...args) => spawnRuntime.observeRequests(() => canvasSpawnRunner(...args)),
  })
  const mount = {
    mountId: 'mount',
    targetId: 'target',
    projectId: 'project',
    endpointId: 'local',
    rootPath: '/repo',
    rootUri: 'file:///repo',
  }
  const topology = {
    resolveMountTarget: async () => mount,
    listMounts: async () => ({ mounts: [mount] }),
    listEndpoints: async () => ({ endpoints: [] }),
  } as never
  registerOperation(surface, mountListOperation, {
    handle: async () => ({ mounts: [mount] }),
    defaultErrorCode: 'common.unexpected',
  })
  registerNodeControlHandlers(surface, {
    getPersistenceStore,
    topology,
    agentSpawnRuntime: {
      ...spawnRuntime.port,
      isSessionActive: id => alive.has(id) && !inactive.has(id),
    },
    killExactSession: kill,
  })
  const registry = createTestAgentProviderRegistry()
  Object.assign(registry.require('claude-code').launcher, {
    createLaunchPlan: async (input: { mode: string; resumeSessionId: string }) => ({
      command: '/bin/sh',
      args: [],
      env: {},
      effectiveModel: null,
      launchMode: input.mode,
      resumeSessionId: input.mode === 'resume' ? input.resumeSessionId : 'new-conversation',
    }),
  })
  const deps = {
    ...admission,
    terminalAgentActivity: options.terminalAgentActivity,
    userDataPath: '/tmp/opencove-snapshot-contract',
    getPersistenceStore,
    approvedWorkspaces: { isPathApproved: async () => true } as never,
    agentProviderRegistry: registry,
    topology,
    ptyRuntime: spawnRuntime.runtime,
    ptyStreamHub: {
      isSessionActive: (id: string) => alive.has(id) && !inactive.has(id),
      registerSessionMetadata: () => {},
    } as never,
  }
  registerSessionHandlers(surface, deps)
  registerSessionStreamingHandlers(surface, deps)
  registerPtyMountHandlers(surface, deps)
  const ctx = {
    clientFeatures: { managedClaudeResumeBindingV1: true },
    now: () => new Date(),
    capabilities: {},
  } as ControlSurfaceContext
  const invoke = async <T>(
    request: ControlSurfaceInvokeRequest,
    context: ControlSurfaceContext = ctx,
  ): Promise<T> => {
    const response = await surface.invoke(context, request)
    if (!response.ok) {
      throw createAppError(response.error)
    }
    results.push({ id: request.id, value: response.value })
    return response.value as T
  }
  surface.register('system.capabilities', {
    kind: 'query',
    validate: x => x,
    handle: () => ({ features: { managedClaudeResumeBindingDeliveryV1: true } }),
    defaultErrorCode: 'common.unexpected',
  })
  const launch = vi.fn(async (payload: object) =>
    invoke({ kind: 'command', id: 'session.launchAgent', payload }),
  )
  const state = normalizePersistedAppState(await store.readAppState())!
  return {
    store,
    runtime,
    invoke,
    launch,
    state,
    mount,
    alive,
    inactive,
    spawn,
    spawnRuntime,
    initialRevision,
    publications,
    results,
    dispose: () => {
      spawnRuntime.dispose()
      runtime.dispose()
      store.dispose()
    },
  }
}
export type SnapshotFixture = Awaited<ReturnType<typeof snapshotFixture>>
