import { renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../src/contexts/workspace/presentation/renderer/types'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../src/contexts/settings/domain/agentEnv'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import { createAppError } from '../../src/shared/errors/appError'
import type { ManagedClaudeLifecycleReceipt } from '../../src/shared/contracts/managedClaudeLaunch'
export function rendererLifecycleFixture(mounted: boolean, persisted = true) {
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
      document: null,
      website: null,
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
    if (request.id === 'system.capabilities') {
      return { features: { managedClaudeResumeBindingDeliveryV1: true } }
    }
    if (request.id === 'node.get') {
      if (!persisted) {
        throw createAppError('node.not_found')
      }
      return { node: { data: { kind: 'agent', executionDirectory: '/repo' } } }
    }
    if (request.id === 'node.managedClaudeBinding') {
      return {
        managedClaudeBinding: launch.mock.calls.length ? binding : null,
        retired: false,
        executionDirectory: null,
      }
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
