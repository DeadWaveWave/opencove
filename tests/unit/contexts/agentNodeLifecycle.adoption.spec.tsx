import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import { runTaskAgentAction } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.run'
import type { TaskActionContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTaskActions.agentSession.shared'
import { createAppError } from '../../../src/shared/errors/appError'
import { absent, compatibilityFixture } from './managedClaudeLaunchCompatibility.helpers'
import { admitManagedClaudeLaunch } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import type { ManagedClaudeLifecycleReceipt } from '../../../src/shared/contracts/managedClaudeLaunch'
function fixture(mounted: boolean, persisted = true) {
  const node: Node<TerminalNodeData> = {
    id: 'agent',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      sessionId: 'old',
      title: 'Agent',
      width: 600,
      height: 400,
      status: 'standby',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider: 'claude-code',
        prompt: 'fixture',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: 'cached',
        resumeSessionIdVerified: true,
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
      note: null,
      image: null,
    },
  }
  const nodesRef = { current: [node] }
  const binding = {
    nodeId: 'agent',
    activationId: 'adopted',
    runtimeSessionId: 'new',
    tuple: { resumeSessionId: 'effective', resumeSessionIdVerified: true },
    nodeSeen: persisted,
    bindingRevision: 1,
    observedRevision: 1,
  }
  const response = {
    sessionId: 'new',
    profileId: null,
    effectiveModel: null,
    resumeSessionId: 'effective',
    startedAt: '2026-11-11T00:00:00Z',
    managedClaudeLifecycle: { binding, commitRevision: 1 } as
      | ManagedClaudeLifecycleReceipt
      | undefined,
    executionContext: {
      workingDirectory: '/repo',
      endpoint: { endpointId: 'local' },
      mountId: mounted ? 'mount' : null,
    },
  }
  const launch = vi.fn(
    async (_request: Parameters<typeof window.opencoveApi.agent.launch>[0]) => response,
  )
  const invoke = vi.fn(async request => {
    if (request.id === 'node.get') {
      if (!persisted) {
        throw createAppError('node.not_found')
      }
      return { node: { data: { kind: 'agent', executionDirectory: '/repo' } } }
    }
    if (request.id === 'node.managedClaudeBinding') {
      return { managedClaudeBinding: null, retired: false, executionDirectory: null }
    }
    if (request.id === 'mount.list') {
      return {
        mounts: mounted
          ? [
              {
                mountId: 'mount',
                projectId: 'workspace',
                endpointId: 'local',
                rootPath: '/repo',
                rootUri: 'file:///repo',
              },
            ]
          : [],
      }
    }
    if (request.id === 'session.launchAgentInMount') {
      return launch(request.payload)
    }
    throw new Error(`Unexpected request ${request.id}`)
  })
  window.opencoveApi = {
    controlSurface: { invoke },
    agent: { launch },
    pty: { kill: vi.fn(async () => {}) },
  } as unknown as typeof window.opencoveApi
  const setNodes = (update: (previous: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
    nodesRef.current = update(nodesRef.current)
  }
  const spacesRef = {
    current: mounted
      ? [
          {
            id: 'space',
            name: 'Main',
            directoryPath: '/repo',
            targetMountId: 'mount',
            labelColor: null,
            nodeIds: ['agent'],
            rect: null,
          },
        ]
      : [],
  }
  const hook = renderHook(() =>
    useWorkspaceCanvasAgentNodeLifecycle({
      workspaceId: 'workspace',
      workspacePath: '/repo',
      nodesRef,
      spacesRef,
      onSpacesChange: vi.fn(),
      setNodes,
      bumpAgentLaunchToken: () => 1,
      isAgentLaunchTokenCurrent: () => true,
      agentFullAccess: false,
      codexReuseRunningAppServer: false,
      defaultTerminalProfileId: null,
      terminalFontSize: 13,
      terminalDisplayMetrics: { fontSize: 13 },
      agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
    }),
  )
  return { ...hook, nodesRef, spacesRef, setNodes, launch, invoke, response }
}
describe('existing unowned Claude renderer launches', () => {
  it.each([false, true])(
    'selects a conversation in another directory without adopting the unowned node (flag=%s)',
    async enabled => {
      const f = fixture(false)
      const worker = compatibilityFixture({ enabled })
      worker.spawn.mockImplementation(async () => {
        await admitManagedClaudeLaunch('claude-code', '/other')
        return {
          sessionId: 'replacement',
          provider: 'claude-code',
          resumeSessionId: 'selected',
          executionContext: { endpoint: { kind: 'local' } },
        }
      })
      f.launch.mockImplementation(async request => {
        const result = await worker.launch(request)
        if (!result.ok) {
          throw createAppError(result.error)
        }
        const value = result.value as {
          sessionId: string
          resumeSessionId: string
          managedClaudeLifecycle?: ManagedClaudeLifecycleReceipt
        }
        return {
          ...f.response,
          sessionId: value.sessionId,
          resumeSessionId: value.resumeSessionId,
          managedClaudeLifecycle: value.managedClaudeLifecycle,
          executionContext: { ...f.response.executionContext, workingDirectory: request.cwd },
        }
      })
      try {
        await act(() =>
          f.result.current.switchAgentNodeSession('agent', {
            provider: 'claude-code',
            sessionId: 'selected',
            cwd: '/other',
          } as never),
        )
        expect(f.launch).toHaveBeenCalledWith(
          expect.objectContaining({
            cwd: '/other',
            intent: { kind: 'resumeConversation', resumeSessionId: 'selected', expected: absent },
          }),
        )
        expect(f.nodesRef.current[0].data).toMatchObject({
          sessionId: 'replacement',
          lastError: null,
          agent: {
            executionDirectory: '/other',
            resumeSessionId: 'selected',
            resumeSessionIdVerified: true,
          },
        })
        expect(window.opencoveApi.pty.kill).toHaveBeenCalledExactlyOnceWith({ sessionId: 'old' })
        expect(worker.spawn).toHaveBeenCalledTimes(1)
        expect(worker.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
      } finally {
        worker.runtime.dispose()
      }
    },
  )
  it.each([false, true])(
    'sends an absent-row launchNew intent for relaunch (mounted=%s)',
    async mounted => {
      const f = fixture(mounted)
      await act(() => f.result.current.launchAgentInNode('agent', 'new'))
      expect(f.launch).toHaveBeenCalledWith(
        expect.objectContaining({ intent: { kind: 'launchNew', expected: absent } }),
      )
      expect(f.nodesRef.current[0].data.agent?.resumeSessionId).toBe('effective')
    },
  )
  it('relaunches an unpersisted node after definitive ledger absence', async () => {
    const f = fixture(false, false)
    await act(() => f.result.current.launchAgentInNode('agent', 'new'))
    expect(f.launch).toHaveBeenCalledTimes(1)
  })
  it('sends adoption intent when task reuse starts from an unowned linked agent', async () => {
    const f = fixture(false)
    f.nodesRef.current.push({
      id: 'task',
      position: { x: 0, y: 0 },
      data: {
        ...f.nodesRef.current[0].data,
        kind: 'task',
        title: 'Task',
        agent: null,
        task: { requirement: 'Next task', linkedAgentNodeId: 'agent' } as never,
      },
    })
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
    await act(() => runTaskAgentAction('task', taskContext))
    expect(f.launch).toHaveBeenCalledWith(
      expect.objectContaining({ intent: { kind: 'launchNew', expected: absent } }),
    )
  })
})

it('takes the resolved route for a managed row-only node without a stored identity', async () => {
  const f = fixture(false, false)
  f.nodesRef.current[0].data.workerBinding = null
  await act(() => f.result.current.launchAgentInNode('agent', 'new'))
  expect(f.response.managedClaudeLifecycle?.binding.nodeSeen).toBe(false)
  expect(f.nodesRef.current[0].data.workerBinding).toEqual({ endpointId: 'local', mountId: null })
})
