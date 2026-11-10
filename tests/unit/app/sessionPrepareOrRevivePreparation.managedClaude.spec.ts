import { describe, it, expect, vi } from 'vitest'
import { prepareAgentNode } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { normalizePersistedAgent } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveShared'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { createAppError } from '../../../src/shared/errors/appError'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'

function fixture(status: string, verified = true) {
  let binding: ManagedClaudeBindingObservation = {
    nodeId: 'agent',
    activationId: 'old',
    runtimeSessionId: 'old-runtime',
    tuple: { resumeSessionId: verified ? 'B' : null, resumeSessionIdVerified: verified },
    nodeSeen: true,
    bindingRevision: 2,
    observedRevision: 2,
  }
  const agent = normalizePersistedAgent({
    provider: 'claude-code',
    prompt: '',
    executionDirectory: '/repo',
    resumeSessionId: 'A',
    resumeSessionIdVerified: true,
  })!
  const workspace = normalizePersistedAppState({
    workspaces: [
      {
        id: 'workspace',
        name: 'Workspace',
        path: '/repo',
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            status,
            agent,
            workerBinding: { endpointId: 'local', mountId: null },
          },
        ],
      },
    ],
  })!.workspaces[0]
  const calls: string[] = []
  const store = {
    observeManagedClaudeNode: () => ({
      nodeId: 'agent',
      binding,
      retired: false,
      context: {
        kind: 'agent',
        provider: 'claude-code',
        directory: '/repo',
        route: '{"endpointId":"local","mountId":null}',
      },
    }),
    isManagedClaudeRuntimeReferenced: () => false,
    activateManagedClaudeRuntime: vi.fn(async input => {
      calls.push('settle')
      binding = {
        ...binding,
        activationId: input.activationId,
        runtimeSessionId: input.runtimeSessionId,
        tuple: input.tuple,
        bindingRevision: 3,
        observedRevision: 3,
      }
      return { status: 'committed', revision: 3 }
    }),
  } satisfies Partial<PersistenceStore>
  let launchError: unknown = new Error('exact resume failed')
  const surface = {
    invoke: vi.fn(async (_ctx, request) => {
      calls.push(request.id)
      if (request.id.startsWith('session.launch')) {
        throw launchError
      }
      return { ok: true, value: { sessionId: 'shell', profileId: null, runtimeKind: 'posix' } }
    }),
  } as unknown as ControlSurface
  const runtime = createManagedClaudeLaunchRuntime({
    getPersistenceStore: async () => store as PersistenceStore,
    hasRuntime: () => false,
    killExactRuntime: vi.fn(async () => {}),
    adoptionEnabled: () => true,
  })
  const prepare = () =>
    runtime.withPreparation(runtime.owner.reserve('agent'), () =>
      prepareAgentNode({
        controlSurface: surface,
        ctx: { now: () => new Date() } as never,
        store: store as PersistenceStore,
        workspace,
        node: workspace.nodes[0],
        space: null,
        agent,
        settings: DEFAULT_AGENT_SETTINGS,
      }),
    )
  return {
    prepare,
    calls,
    store,
    runtime,
    setError: (error: unknown) => {
      launchError = error
    },
  }
}
describe('managed Claude recovery preparation', () => {
  it.each(['stopped', 'exited'])(
    'settles %s fallback before spawning a shell and preserves the committed tuple',
    async status => {
      const { prepare, calls, store } = fixture(status)
      const result = await prepare()
      expect(result.agent).toMatchObject({ resumeSessionId: 'B', resumeSessionIdVerified: true })
      expect(result.managedClaudeLifecycle?.binding.runtimeSessionId).toBeNull()
      expect(result.sessionId).toBe('shell')
      expect(calls.indexOf('settle')).toBeLessThan(calls.indexOf('pty.spawn'))
      expect(store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
    },
  )
  it('owned recovery without a verified target never launches a blank managed conversation', async () => {
    const { prepare, calls } = fixture('exited', false)
    const result = await prepare()
    expect(calls).toEqual(['settle', 'pty.spawn'])
    expect(result.agent?.resumeSessionId).toBeNull()
  })
  it.each(['unknown', 'superseded', 'nodeGone'])(
    'never falls through to fallback on %s',
    async reason => {
      const { prepare, calls, setError } = fixture('exited')
      setError(
        reason === 'unknown'
          ? createAppError('agent.managed_launch_commit_failed', {
              details: { outcome: 'unknown' },
            })
          : createAppError('agent.managed_launch_rejected', { details: { reason } }),
      )
      await expect(prepare()).rejects.toBeDefined()
      expect(calls).toEqual(['session.launchAgent'])
    },
  )
})
