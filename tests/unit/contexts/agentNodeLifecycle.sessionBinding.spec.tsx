import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'

describe('agent relaunch session binding', () => {
  it.each([
    { provider: 'claude-code', mode: 'new', expected: 'assigned-a' },
    { provider: 'claude-code', mode: 'resume', expected: 'verified-a' },
    { provider: 'codex', mode: 'new', expected: null },
    { provider: 'gemini', mode: 'new', expected: null },
  ] as const)(
    'preserves only the owned $provider $mode binding',
    async ({ provider, mode, expected }) => {
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
      window.opencoveApi = {
        agent: {
          launch: vi.fn(async () => ({
            sessionId: 'runtime-a',
            profileId: null,
            runtimeKind: 'posix',
            effectiveModel: null,
            resumeSessionId: 'assigned-a',
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
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: { fontSize: 13 },
          agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
        }),
      )
      await act(() => result.current.launchAgentInNode(node.id, mode))
      expect(window.opencoveApi.agent.launch).toHaveBeenCalledOnce()
      expect(nodesRef.current[0].data.agent).toMatchObject({
        resumeSessionId: expected,
        resumeSessionIdVerified: expected !== null,
      })
    },
  )
})
