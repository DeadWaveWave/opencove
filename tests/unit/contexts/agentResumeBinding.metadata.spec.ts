import { describe, expect, it } from 'vitest'
import { resolveObservedResumeSessionBindingUpdate } from '../../../src/contexts/agent/domain/agentResumeBinding'
import { updateWorkspacesWithAgentMetadata } from '../../../src/app/renderer/shell/hooks/usePtyWorkspaceRuntimeSync'
import { applyAgentMetadataToNodes } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'

function createAgentNode({
  resumeSessionId,
  resumeSessionIdVerified,
  launchMode = 'new',
}: {
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
  launchMode?: 'new' | 'resume'
}) {
  return {
    id: 'agent-1',
    type: 'terminal',
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      title: 'Agent',
      sessionId: 'runtime-1',
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider: 'claude-code',
        prompt: 'Ship it',
        model: null,
        effectiveModel: null,
        launchMode,
        resumeSessionId,
        resumeSessionIdVerified,
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
  } as never
}

describe('agent resume metadata binding', () => {
  it('ignores runtime metadata that conflicts with a verified durable binding', () => {
    expect(
      resolveObservedResumeSessionBindingUpdate(
        {
          provider: 'claude-code',
          resumeSessionId: 'durable-session',
          resumeSessionIdVerified: true,
        },
        'unrelated-session',
      ),
    ).toBeNull()

    const prevNodes = [
      createAgentNode({
        launchMode: 'resume',
        resumeSessionId: 'durable-session',
        resumeSessionIdVerified: true,
      }),
    ]
    const result = applyAgentMetadataToNodes(prevNodes, {
      sessionId: 'runtime-1',
      resumeSessionId: 'unrelated-session',
    })

    expect(result.didChange).toBe(false)
    expect(result.nextNodes).toBe(prevNodes)
  })

  it('promotes runtime metadata only when the durable binding is not verified', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      nodes: [
        createAgentNode({
          resumeSessionId: null,
          resumeSessionIdVerified: false,
        }),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
    } as never

    const result = updateWorkspacesWithAgentMetadata({
      workspaces: [workspace],
      sessionId: 'runtime-1',
      resumeSessionId: 'observed-session',
    })

    expect(result.didChange).toBe(true)
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agent?.resumeSessionId).toBe('observed-session')
    expect(result.nextWorkspaces[0]?.nodes[0]?.data.agent?.resumeSessionIdVerified).toBe(true)
  })
})
