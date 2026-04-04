import { describe, expect, it } from 'vitest'
import { updateWorkspacesWithAgentExit } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import {
  applyAgentExitToNodes,
  applyAgentStateToNodes,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

describe('PTY task completion side effects', () => {
  it('returns the original node array when a state event does not change any agent node', () => {
    const prevNodes = [
      {
        id: 'agent-1',
        type: 'terminal',
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        data: {
          kind: 'agent',
          title: 'Agent',
          sessionId: 'session-1',
          status: 'standby',
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: {
            provider: 'opencode',
            prompt: 'Ship it',
            model: null,
            effectiveModel: null,
            launchMode: 'resume',
            resumeSessionId: 'resume-1',
            resumeSessionIdVerified: true,
            executionDirectory: '/tmp/workspace',
            expectedDirectory: '/tmp/workspace',
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: null,
          },
          task: null,
          note: null,
        },
      },
    ]

    const sameStatusResult = applyAgentStateToNodes(prevNodes, {
      sessionId: 'session-1',
      state: 'standby',
    })
    expect(sameStatusResult.didChange).toBe(false)
    expect(sameStatusResult.nextNodes).toBe(prevNodes)

    const unrelatedSessionResult = applyAgentStateToNodes(prevNodes, {
      sessionId: 'session-2',
      state: 'working',
    })
    expect(unrelatedSessionResult.didChange).toBe(false)
    expect(unrelatedSessionResult.nextNodes).toBe(prevNodes)
  })

  it('updates the matching agent node when a state event changes runtime status', () => {
    const prevNodes = [
      {
        id: 'agent-1',
        type: 'terminal',
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        data: {
          kind: 'agent',
          title: 'Agent',
          sessionId: 'session-1',
          status: 'standby',
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          agent: {
            provider: 'opencode',
            prompt: 'Ship it',
            model: null,
            effectiveModel: null,
            launchMode: 'resume',
            resumeSessionId: 'resume-1',
            resumeSessionIdVerified: true,
            executionDirectory: '/tmp/workspace',
            expectedDirectory: '/tmp/workspace',
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
            taskId: null,
          },
          task: null,
          note: null,
        },
      },
    ]

    const result = applyAgentStateToNodes(prevNodes, {
      sessionId: 'session-1',
      state: 'working',
    })

    expect(result.didChange).toBe(true)
    expect(result.nextNodes).not.toBe(prevNodes)
    expect(result.nextNodes[0]?.data.status).toBe('running')
  })

  it('does not mark linked tasks as ai_done in canvas node updates', () => {
    const result = applyAgentExitToNodes(
      [
        {
          id: 'agent-1',
          type: 'terminal',
          position: { x: 0, y: 0 },
          width: 320,
          height: 240,
          data: {
            kind: 'agent',
            title: 'Agent',
            sessionId: 'session-1',
            status: 'running',
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            agent: {
              provider: 'codex',
              prompt: 'Ship it',
              model: null,
              effectiveModel: null,
              launchMode: 'new',
              resumeSessionId: null,
              resumeSessionIdVerified: false,
              executionDirectory: '/tmp/workspace',
              expectedDirectory: '/tmp/workspace',
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
              taskId: 'task-1',
            },
            task: null,
            note: null,
          },
        },
        {
          id: 'task-1',
          type: 'terminal',
          position: { x: 0, y: 0 },
          width: 320,
          height: 240,
          data: {
            kind: 'task',
            title: 'Task',
            sessionId: '',
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            agent: null,
            task: {
              requirement: 'Finish the work',
              status: 'doing',
              priority: 'medium',
              tags: [],
              linkedAgentNodeId: 'agent-1',
              agentSessions: [],
              lastRunAt: null,
              autoGeneratedTitle: false,
              createdAt: null,
              updatedAt: null,
            },
            note: null,
          },
        },
      ],
      { sessionId: 'session-1', exitCode: 0 },
    )

    expect(result.didChange).toBe(true)
    expect(result.nextNodes[0]?.data.status).toBe('exited')
    expect(result.nextNodes[1]?.data.kind).toBe('task')
    expect(result.nextNodes[1]?.data.task?.status).toBe('doing')
  })

  it('does not mark linked tasks as ai_done in workspace runtime sync', () => {
    const workspaces: WorkspaceState[] = [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        nodes: [
          {
            id: 'agent-1',
            type: 'terminal',
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            data: {
              kind: 'agent',
              title: 'Agent',
              sessionId: 'session-1',
              status: 'running',
              startedAt: null,
              endedAt: null,
              exitCode: null,
              lastError: null,
              scrollback: null,
              agent: {
                provider: 'codex',
                prompt: 'Ship it',
                model: null,
                effectiveModel: null,
                launchMode: 'new',
                resumeSessionId: null,
                resumeSessionIdVerified: false,
                executionDirectory: '/tmp/workspace',
                expectedDirectory: '/tmp/workspace',
                directoryMode: 'workspace',
                customDirectory: null,
                shouldCreateDirectory: false,
                taskId: 'task-1',
              },
              task: null,
              note: null,
            },
          },
          {
            id: 'task-1',
            type: 'terminal',
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            data: {
              kind: 'task',
              title: 'Task',
              sessionId: '',
              status: null,
              startedAt: null,
              endedAt: null,
              exitCode: null,
              lastError: null,
              scrollback: null,
              agent: null,
              task: {
                requirement: 'Finish the work',
                status: 'doing',
                priority: 'medium',
                tags: [],
                linkedAgentNodeId: 'agent-1',
                agentSessions: [],
                lastRunAt: null,
                autoGeneratedTitle: false,
                createdAt: null,
                updatedAt: null,
              },
              note: null,
            },
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        nextNodeOffset: { x: 0, y: 0 },
        minimapVisible: true,
        focusSequence: 0,
        spaces: [],
        activeSpaceId: null,
      },
    ]

    const result = updateWorkspacesWithAgentExit({
      workspaces,
      sessionId: 'session-1',
      excludeWorkspaceId: null,
      exitCode: 0,
      now: '2026-03-15T08:00:00.000Z',
    })

    expect(result.didChange).toBe(true)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.status).toBe('exited')
    expect(result.nextWorkspaces[0]?.nodes[1]?.data.kind).toBe('task')
    expect(result.nextWorkspaces[0]?.nodes[1]?.data.task?.status).toBe('doing')
  })
})
