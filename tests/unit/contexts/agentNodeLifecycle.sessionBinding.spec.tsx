import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'

describe('agent relaunch session binding', () => {
  it.each([
    { provider: 'claude-code', mode: 'new', expected: 'assigned-a', owned: false },
    { provider: 'claude-code', mode: 'resume', expected: 'verified-a', owned: false },
    { provider: 'codex', mode: 'new', expected: null, owned: false },
    { provider: 'gemini', mode: 'new', expected: null, owned: false },
    { provider: 'claude-code', mode: 'resume', expected: 'committed-b', owned: true },
    { provider: 'claude-code', mode: 'new', expected: 'committed-b', owned: true },
  ] as const)(
    'preserves only the owned $provider $mode binding',
    async ({ provider, mode, expected, owned }) => {
      const node: Node<TerminalNodeData> = {
        id: 'agent-a',
        position: { x: 0, y: 0 },
        data: {
          kind: 'agent',
          sessionId: '',
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
            provider,
            prompt: 'fixture',
            model: null,
            effectiveModel: null,
            launchMode: 'new',
            resumeSessionId: 'verified-a',
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
        nodeId: node.id,
        activationId: 'owned',
        runtimeSessionId: 'old-runtime',
        tuple: { resumeSessionId: 'committed-b', resumeSessionIdVerified: true },
        nodeSeen: true,
        bindingRevision: 2,
        observedRevision: 2,
      }
      const receipt = {
        binding: {
          ...binding,
          activationId: 'new',
          runtimeSessionId: 'runtime-a',
          observedRevision: 3,
        },
        commitRevision: 3,
      }
      if (owned) {
        node.data.sessionId = 'old-runtime'
      }
      window.opencoveApi = {
        ...(provider === 'claude-code'
          ? {
              controlSurface: {
                invoke: vi.fn(async request =>
                  request.id === 'node.managedClaudeBinding'
                    ? {
                        managedClaudeBinding: owned ? binding : null,
                        retired: false,
                        executionDirectory: '/repo',
                      }
                    : request.id === 'system.capabilities'
                      ? { features: { managedClaudeResumeBindingDeliveryV1: true } }
                      : { mounts: [] },
                ),
              },
            }
          : {}),
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'runtime-a',
            profileId: null,
            runtimeKind: 'posix',
            effectiveModel: null,
            resumeSessionId: 'assigned-a',
            ...(owned ? { managedClaudeLifecycle: receipt } : {}),
          })),
        },
        pty: { kill: vi.fn() },
      } as unknown as typeof window.opencoveApi
      const { result } = renderHook(() =>
        useWorkspaceCanvasAgentNodeLifecycle({
          workspaceId: 'workspace-a',
          workspacePath: '/repo',
          nodesRef,
          spacesRef: { current: [] },
          onSpacesChange: vi.fn(),
          setNodes: updater => {
            nodesRef.current = updater(nodesRef.current)
          },
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
      await act(() => result.current.launchAgentInNode(node.id, mode))
      expect(window.opencoveApi.agent.launch).toHaveBeenCalledOnce()
      if (owned) {
        expect(window.opencoveApi.pty.kill).not.toHaveBeenCalled()
        expect(window.opencoveApi.agent.launch).toHaveBeenCalledWith(
          expect.objectContaining({
            intent: expect.objectContaining({
              kind: mode === 'resume' ? 'resumeCurrent' : 'launchNew',
            }),
          }),
        )
      }
      expect(nodesRef.current[0].data.agent).toMatchObject({
        resumeSessionId: expected,
        resumeSessionIdVerified: expected !== null,
      })
    },
  )
})
