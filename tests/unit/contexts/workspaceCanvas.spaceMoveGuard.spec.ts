import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { TranslateFn } from '../../../src/app/renderer/i18n'
import { validateSpaceTransfer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

const workspacePath = '/tmp/repo'
const worktreePath = `${workspacePath}/.opencove/worktrees/demo`

function createNode(
  id: string,
  data: Partial<TerminalNodeData> & Pick<TerminalNodeData, 'kind' | 'title' | 'sessionId'>,
): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    draggable: true,
    selectable: true,
    data: {
      sessionId: data.sessionId,
      title: data.title,
      width: 460,
      height: 300,
      kind: data.kind,
      status: data.status ?? null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: data.executionDirectory,
      expectedDirectory: data.expectedDirectory,
      agent: data.agent ?? null,
      task: data.task ?? null,
      note: null,
    },
  }
}

const worktreeSpace: WorkspaceSpaceState = {
  id: 'space-worktree',
  name: 'Worktree',
  directoryPath: worktreePath,
  nodeIds: [],
  rect: null,
}

const rootSpace: WorkspaceSpaceState | null = null
const t: TranslateFn = key => {
  switch (key) {
    case 'messages.agentSpaceDirectoryMismatch':
      return 'Agent windows cannot enter or leave a space with a different directory.'
    case 'messages.terminalSpaceDirectoryMismatch':
      return 'Terminal windows cannot enter or leave a space with a different directory.'
    case 'messages.taskSpaceMoveBlocked':
      return 'Tasks with active agents cannot be moved between spaces.'
    default:
      return key
  }
}

describe('workspaceCanvas space move guard', () => {
  it('blocks agent windows from entering a space with a different directory', () => {
    const agentNode = createNode('agent-1', {
      kind: 'agent',
      title: 'Agent',
      sessionId: 'agent-session',
      status: 'standby',
      agent: {
        provider: 'codex',
        prompt: 'Test',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: workspacePath,
        expectedDirectory: workspacePath,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
    })

    expect(validateSpaceTransfer(['agent-1'], [agentNode], worktreeSpace, workspacePath, t)).toBe(
      'Agent windows cannot enter or leave a space with a different directory.',
    )
  })

  it('allows agent windows to enter a space with a different directory when directory mismatch is allowed', () => {
    const agentNode = createNode('agent-1', {
      kind: 'agent',
      title: 'Agent',
      sessionId: 'agent-session',
      status: 'standby',
      agent: {
        provider: 'codex',
        prompt: 'Test',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: workspacePath,
        expectedDirectory: workspacePath,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
    })

    expect(
      validateSpaceTransfer(['agent-1'], [agentNode], worktreeSpace, workspacePath, t, {
        allowDirectoryMismatch: true,
      }),
    ).toBeNull()
  })

  it('blocks terminal windows from leaving to a different directory root', () => {
    const terminalNode = createNode('terminal-1', {
      kind: 'terminal',
      title: 'Terminal',
      sessionId: 'terminal-session',
      executionDirectory: worktreePath,
      expectedDirectory: worktreePath,
    })

    expect(validateSpaceTransfer(['terminal-1'], [terminalNode], rootSpace, workspacePath, t)).toBe(
      'Terminal windows cannot enter or leave a space with a different directory.',
    )
  })

  it('allows terminal windows to leave to a different directory root when directory mismatch is allowed', () => {
    const terminalNode = createNode('terminal-1', {
      kind: 'terminal',
      title: 'Terminal',
      sessionId: 'terminal-session',
      executionDirectory: worktreePath,
      expectedDirectory: worktreePath,
    })

    expect(
      validateSpaceTransfer(['terminal-1'], [terminalNode], rootSpace, workspacePath, t, {
        allowDirectoryMismatch: true,
      }),
    ).toBeNull()
  })

  it('allows moving tasks when the linked agent is inactive', () => {
    const inactiveAgent = createNode('agent-idle', {
      kind: 'agent',
      title: 'Idle Agent',
      sessionId: 'agent-idle-session',
      status: 'exited',
      agent: {
        provider: 'codex',
        prompt: 'Test',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: workspacePath,
        expectedDirectory: workspacePath,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: 'task-1',
      },
    })
    const taskNode = createNode('task-1', {
      kind: 'task',
      title: 'Task',
      sessionId: '',
      task: {
        requirement: 'Move me',
        status: 'todo',
        priority: 'medium',
        tags: [],
        linkedAgentNodeId: 'agent-idle',
        agentSessions: [],
        lastRunAt: null,
        autoGeneratedTitle: false,
        createdAt: null,
        updatedAt: null,
      },
    })

    expect(
      validateSpaceTransfer(['task-1'], [taskNode, inactiveAgent], worktreeSpace, workspacePath, t),
    ).toBeNull()
  })

  it('blocks moving tasks with active agents between spaces', () => {
    const activeAgent = createNode('agent-active', {
      kind: 'agent',
      title: 'Active Agent',
      sessionId: 'agent-active-session',
      status: 'standby',
      agent: {
        provider: 'codex',
        prompt: 'Test',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: workspacePath,
        expectedDirectory: workspacePath,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: 'task-1',
      },
    })
    const taskNode = createNode('task-1', {
      kind: 'task',
      title: 'Task',
      sessionId: '',
      task: {
        requirement: 'Move me',
        status: 'doing',
        priority: 'medium',
        tags: [],
        linkedAgentNodeId: 'agent-active',
        agentSessions: [],
        lastRunAt: null,
        autoGeneratedTitle: false,
        createdAt: null,
        updatedAt: null,
      },
    })

    expect(
      validateSpaceTransfer(['task-1'], [taskNode, activeAgent], worktreeSpace, workspacePath, t),
    ).toBe('Tasks with active agents cannot be moved between spaces.')
  })
})
