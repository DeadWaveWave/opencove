/* eslint-disable no-await-in-loop -- Each compatibility case executes sequential lifecycle effects. */
import { act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { workerOwnershipCompatibilityCases } from '../../support/workerOwnershipCompatibility'
import { checkLegacyPreparationInterleaving } from '../../support/managedClaudePreparationInterleaving'
import { rendererLifecycleFixture } from '../../support/managedClaudeRendererLifecycle'
import { compatibilityFixture } from '../../unit/contexts/managedClaudeLaunchCompatibility.helpers'
import { admitManagedClaudeLaunch } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionPrepareOrReviveHandler } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import { runTaskAgentAction } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run'
import type { TaskActionContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.shared'
import { launchWorkspaceAgentSession } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { prepareWorkspaceRuntimeNodes } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { createAppError } from '../../../src/shared/errors/appError'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { invokeBrowserControlSurface } from '../../../src/app/renderer/browser/browserControlSurface'
import { createBrowserAgentApi } from '../../../src/app/renderer/browser/browserOpenCoveApi.agent'
import { toAppErrorDescriptor } from '../../../src/shared/errors/appError'

const originalApi = window.opencoveApi,
  originalState = useAppStore.getState()
afterEach(() => {
  vi.unstubAllGlobals()
  window.opencoveApi = originalApi
  useAppStore.setState(originalState, true)
})
const actions = ['creation', 'relaunch', 'switch', 'task-reuse', 'cold-prepare'] as const
it.each(
  workerOwnershipCompatibilityCases
    .filter(row => row.generation === 'PR3b' && row.profile === 'unowned')
    .flatMap(row => (['mount', 'fallback'] as const).map(phase => ({ ...row, phase }))),
)(
  'fences legacy cold prepare at $phase with concurrent adoption=$adoption client=$client',
  checkLegacyPreparationInterleaving,
)
it.each(
  workerOwnershipCompatibilityCases.flatMap(row => actions.map(action => ({ ...row, action }))),
)(
  'executes $action against $generation $profile $client adoption=$adoption before any unsafe effect',
  async ({ generation, profile, client, adoption, action }) => {
    const lookup = !['pre-W8', 'PR1'].includes(generation) && profile !== 'unknown'
    const delivery = generation === 'PR3b' && lookup
    const persisted = profile !== 'empty' && action !== 'creation'
    const f = rendererLifecycleFixture(false, persisted)
    const worker = compatibilityFixture({
      enabled: adoption && !['pre-W8', 'PR1'].includes(generation),
      persisted,
    })
    worker.spawn.mockImplementation(async () => {
      await admitManagedClaudeLaunch('claude-code', '/repo')
      return {
        sessionId: 'replacement',
        provider: 'claude-code',
        resumeSessionId: 'new',
        executionContext: { endpoint: { kind: 'local' } },
      }
    })
    if (profile === 'owned' && action !== 'creation') {
      await worker.store.activateManagedClaudeRuntime({
        nodeId: 'agent',
        activationId: 'old',
        runtimeSessionId: null,
        tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
      })
      worker.store.activateManagedClaudeRuntime.mockClear()
    }
    registerSessionPrepareOrReviveHandler(worker.surface, {
      getPersistenceStore: worker.getPersistenceStore,
      terminalRecoverySpawnAdmission: worker.admission.terminalSpawnAdmission,
      ptyStreamHub: { isSessionActive: () => false } as unknown as PtyStreamHub,
      ptyRuntime: {
        waitForShellReady: vi.fn(),
        write: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        onMetadata: vi.fn(),
        kill: vi.fn(),
      },
    })
    const baseInvoke = f.invoke.getMockImplementation()!
    const calls: string[] = []
    f.invoke.mockImplementation(async request => {
      calls.push(request.id)
      const wire = request
      if (wire.id === 'system.capabilities') {
        return { features: { managedClaudeResumeBindingDeliveryV1: delivery } }
      }
      if (wire.id === 'system.operations') {
        return {
          protocolVersion: 1,
          operations: lookup ? [{ id: 'node.managedClaudeBinding' }] : [],
        }
      }
      if (wire.id === 'node.managedClaudeBinding') {
        if (!lookup) {
          throw createAppError('common.invalid_input')
        }
        return {
          managedClaudeBinding: worker.store.observeManagedClaudeNode('agent').binding,
          retired: false,
          executionDirectory: '/repo',
        }
      }
      if (wire.id === 'session.prepareOrRevive') {
        const result = await worker.surface.invoke(
          { now: () => new Date(), capabilities: {}, clientFeatures: wire.clientFeatures } as never,
          wire,
        )
        if (!result.ok) {
          throw createAppError(result.error)
        }
        return result.value
      }
      if (wire.id === 'session.launchAgent') {
        return launch(wire.payload)
      }
      return baseInvoke(wire)
    })
    const launch = async (request: object) => {
      calls.push('launch')
      // PR2/PR3a accept managed intent without checking delivery. Execute the real
      // owner/activation lifecycle so omitting negotiation causes a durable effect.
      const result = await worker.launch(request)
      if (!result.ok) {
        throw createAppError(result.error)
      }
      return { ...f.response, ...(result.value as object) }
    }
    f.launch.mockImplementation(launch)
    if (client === 'Web') {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, options) => {
          try {
            const value = await f.invoke(JSON.parse(String(options?.body)))
            return new Response(
              JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value }),
            )
          } catch (error) {
            return new Response(
              JSON.stringify({
                __opencoveControlEnvelope: true,
                ok: false,
                error: toAppErrorDescriptor(error),
              }),
            )
          }
        }),
      )
      window.opencoveApi = {
        ...window.opencoveApi,
        controlSurface: { invoke: invokeBrowserControlSurface },
        agent: createBrowserAgentApi(),
      }
    }
    const taskContext = {
      nodesRef: f.nodesRef,
      spacesRef: f.spacesRef,
      setNodes: f.setNodes,
      workspaceId: 'workspace',
      workspacePath: '/repo',
      agentSettings: DEFAULT_AGENT_SETTINGS,
      onSpacesChange: vi.fn(),
      onRequestPersistFlush: vi.fn(),
      buildAgentNodeTitle: () => 'Agent',
      launchAgentInNode: f.result.current.launchAgentInNode,
      t: (key: string) => key,
    } as unknown as TaskActionContext
    try {
      await act(async () => {
        if (action === 'creation') {
          await launchWorkspaceAgentSession({
            canvasNodeId: 'agent',
            workspaceId: 'workspace',
            mountId: null,
            workspacePath: '/repo',
            executionDirectory: '/repo',
            prompt: 'Review',
            provider: 'claude-code',
            mode: 'new',
            model: null,
            mergedEnv: {},
            agentSettings: DEFAULT_AGENT_SETTINGS,
            launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
          })
        } else if (action === 'relaunch') {
          await f.result.current.launchAgentInNode('agent', 'new')
        } else if (action === 'switch') {
          await f.result.current.switchAgentNodeSession('agent', {
            provider: 'claude-code',
            sessionId: 'selected',
            cwd: '/repo',
          } as never)
        } else if (action === 'task-reuse') {
          f.nodesRef.current.push({
            id: 'task',
            position: { x: 0, y: 0 },
            data: {
              ...f.nodesRef.current[0].data,
              kind: 'task',
              agent: null,
              task: { requirement: 'Next task', linkedAgentNodeId: 'agent' } as never,
            },
          })
          await runTaskAgentAction('task', taskContext)
          if (!delivery) {
            expect(f.nodesRef.current.find(node => node.id === 'task')?.data.lastError).toMatch(
              /Worker/,
            )
          }
        } else {
          const prepared = await prepareWorkspaceRuntimeNodes({
            workspace: ensurePersistedWorkspace(worker.state.workspaces[0])!,
            agentSettings: DEFAULT_AGENT_SETTINGS,
          })
          if (profile === 'empty') {
            expect(prepared).toEqual([])
          } else if (!delivery) {
            expect(prepared[0].data.lastError).toMatch(/Worker/)
          }
        }
      })
      if (profile === 'empty' && action === 'cold-prepare') {
        expect(calls).toEqual([])
        expect(worker.spawn).not.toHaveBeenCalled()
        expect(worker.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
      } else if (delivery || action === 'creation') {
        expect(calls).toContain('system.capabilities')
        expect(worker.spawn).toHaveBeenCalledOnce()
        expect(worker.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(
          delivery && (adoption || (profile === 'owned' && action !== 'creation')) ? 1 : 0,
        )
      } else {
        expect(worker.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
        expect(worker.spawn).not.toHaveBeenCalled()
        expect(window.opencoveApi.pty.kill).not.toHaveBeenCalled()
        expect(calls).not.toContain('session.prepareOrRevive')
        expect(taskContext.onSpacesChange).not.toHaveBeenCalled()
        expect(taskContext.onRequestPersistFlush).not.toHaveBeenCalled()
        expect(f.nodesRef.current[0].data.agent?.prompt).toBe('fixture')
        if (action === 'relaunch' || action === 'switch') {
          expect(f.nodesRef.current[0].data.lastError).toMatch(/Worker/)
        }
      }
    } finally {
      f.unmount()
      worker.runtime.dispose()
    }
  },
)
