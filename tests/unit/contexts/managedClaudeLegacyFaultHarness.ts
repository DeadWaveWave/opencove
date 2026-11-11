// @vitest-environment node
import { expect, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { context } from './managedClaudeLaunchCompatibility.helpers'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from './controlSurfaceTestTerminalAvailability'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))

export const failures = ['none', 'identity', 'validation', 'spawn', 'registration'] as const
type Failure = (typeof failures)[number]

export async function executeLegacyFault(options: {
  wrapped: boolean
  enabled: boolean
  provider: 'claude-code' | 'codex'
  failure: Failure
}) {
  const effects: string[] = []
  const state = {
    formatVersion: 1,
    settings: {},
    workspaces: [
      {
        id: 'workspace',
        name: 'Workspace',
        path: '/repo',
        spaces: [],
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            sessionId: 'original',
            status: 'standby',
            agent: { provider: options.provider, prompt: 'fixture', executionDirectory: '/repo' },
          },
        ],
      },
    ],
  }
  const store = {
    readAppState: async () => {
      if (options.failure === 'identity') {
        throw new Error('identity read unavailable')
      }
      return state
    },
    observeManagedClaudeNode: (nodeId: string) => ({
      nodeId,
      binding: null,
      retired: false,
      nodeRuntimeSessionId: 'original',
      context: { kind: 'agent', provider: options.provider, directory: '/repo', route: 'null' },
    }),
    activateManagedClaudeRuntime: () => {
      effects.push('activation')
      throw new Error('unexpected managed write')
    },
    isManagedClaudeRuntimeReferenced: () => {
      effects.push('reference')
      return false
    },
  } as unknown as PersistenceStore
  const admission = createReadyTerminalAdmissionDeps()
  const runtime = createManagedClaudeLaunchRuntime({
    getPersistenceStore: async () => store,
    hasRuntime: () => true,
    adoptionEnabled: () => options.enabled,
    killExactRuntime: async () => {
      effects.push('managedKill')
    },
  })
  const surface = createControlSurface(
    options.wrapped
      ? {
          run: createCanvasSpawnRunner({
            managedClaude: runtime,
            terminalRuntimeAvailability: admission.terminalSpawnAdmission,
            getPersistenceStore: async () => store,
          }),
        }
      : {},
  )
  const registry = createTestAgentProviderRegistry()
  Object.assign(registry.require(options.provider).launcher, {
    createLaunchPlan: async () => ({
      command: '/bin/sh',
      args: [],
      env: {},
      effectiveModel: null,
      resumeSessionId: null,
    }),
  })
  registerSessionHandlers(surface, {
    ...admission,
    userDataPath: '/tmp/opencove-legacy-fault-model',
    getPersistenceStore: async () => store,
    approvedWorkspaces: { isPathApproved: async () => options.failure !== 'validation' } as never,
    agentProviderRegistry: registry,
    topology: {} as never,
    ptyRuntime: {
      spawnSession: async () => {
        effects.push('spawn')
        if (options.failure === 'spawn') {
          throw new Error('spawn unavailable')
        }
        return { sessionId: 'replacement' }
      },
    } as never,
    ptyStreamHub: {
      registerSessionMetadata: () => {
        effects.push('registration')
        if (options.failure === 'registration') {
          throw new Error('registration unavailable')
        }
      },
    } as never,
  })
  try {
    const result = await surface.invoke(context, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        canvasNodeId: 'agent',
        workspaceId: 'workspace',
        cwd: '/repo',
        provider: options.provider,
        prompt: 'fixture',
      },
    })
    expect(runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    expect(state.workspaces[0].nodes[0].sessionId).toBe('original')
    return { result, effects }
  } finally {
    runtime.dispose()
  }
}
