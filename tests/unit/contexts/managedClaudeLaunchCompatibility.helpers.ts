import { vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { sessionLaunchAgentOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type {
  ManagedClaudeBindingObservation,
  ManagedClaudeNodeObservation,
} from '../../../src/shared/contracts/managedClaudeLaunch'
import { createReadyTerminalAdmissionDeps } from './controlSurfaceTestTerminalAvailability'

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
export const context = { now: () => new Date(), capabilities: {} } as ControlSurfaceContext
export const absent = {
  activationId: null,
  tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
}
export function compatibilityFixture(
  options: {
    enabled?: boolean
    retired?: boolean
    provider?: 'claude-code' | 'codex'
    persisted?: boolean
  } = {},
) {
  const provider = options.provider ?? 'claude-code'
  const state = normalizePersistedAppState({
    workspaces: [
      {
        id: 'workspace',
        name: 'Workspace',
        path: '/repo',
        nodes:
          options.persisted === false
            ? []
            : [
                {
                  id: 'agent',
                  kind: 'agent',
                  sessionId: 'live',
                  status: 'standby',
                  agent: {
                    provider,
                    prompt: 'fixture',
                    executionDirectory: '/repo',
                    resumeSessionId: 'cached',
                    resumeSessionIdVerified: true,
                  },
                },
              ],
      },
    ],
  })!
  let binding: ManagedClaudeBindingObservation | null = null
  const store = {
    readAppState: vi.fn(async () => state),
    observeManagedClaudeNode: vi.fn(
      (nodeId: string): ManagedClaudeNodeObservation => ({
        nodeId,
        binding,
        retired: options.retired ?? false,
        nodeRuntimeSessionId: binding?.runtimeSessionId ?? 'live',
        context:
          options.persisted === false
            ? null
            : { kind: 'agent', provider, directory: '/repo', route: 'null' },
      }),
    ),
    managedClaudePreparationCandidates: () => (options.persisted === false ? [] : ['agent']),
    isManagedClaudeRuntimeReferenced: vi.fn(() => false),
    activateManagedClaudeRuntime: vi.fn(async input => {
      binding = {
        nodeId: input.nodeId,
        activationId: input.activationId,
        runtimeSessionId: input.runtimeSessionId,
        tuple: input.tuple,
        nodeSeen: options.persisted !== false,
        bindingRevision: 1,
        observedRevision: 1,
      }
      return { status: 'committed' as const, revision: 1 }
    }),
  } satisfies Partial<PersistenceStore>
  const admission = createReadyTerminalAdmissionDeps()
  const getPersistenceStore = async () => store as unknown as PersistenceStore
  const kill = vi.fn(async (_id: string) => {})
  const runtime = createManagedClaudeLaunchRuntime({
    getPersistenceStore,
    killExactRuntime: kill,
    hasRuntime: () => true,
    adoptionEnabled: () => options.enabled ?? false,
  })
  const surface = createControlSurface({
    run: createCanvasSpawnRunner({
      managedClaude: runtime,
      terminalRuntimeAvailability: admission.terminalSpawnAdmission,
      getPersistenceStore,
    }),
  })
  const spawn = vi.fn(async () => ({
    sessionId: 'replacement',
    provider,
    resumeSessionId: 'new',
    executionContext: { endpoint: { kind: 'local' } },
  }))
  registerOperation(surface, sessionLaunchAgentOperation, {
    defaultErrorCode: 'agent.launch_failed',
    handle: async () => spawn(),
  })
  const launch = (payload: object = {}) =>
    surface.invoke(context, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        canvasNodeId: 'agent',
        workspaceId: 'workspace',
        cwd: '/repo',
        provider,
        prompt: 'fixture',
        ...payload,
      },
    })
  return { state, store, runtime, surface, spawn, launch, getPersistenceStore, admission, kill }
}
