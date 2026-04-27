import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type PersistedWorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { toShellWorkspaceState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'

function createPersistedWorkspace(): PersistedWorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Workspace 1',
    path: '/tmp/workspace-1',
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    activeSpaceId: null,
    spaceArchiveRecords: [],
    spaces: [],
    nodes: [
      {
        id: 'terminal-1',
        sessionId: 'terminal-session',
        title: 'Terminal',
        position: { x: 10, y: 20 },
        width: 320,
        height: 240,
        kind: 'terminal',
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: 'terminal history',
        executionDirectory: '/tmp/workspace-1',
        expectedDirectory: '/tmp/workspace-1',
        agent: null,
        task: null,
      },
      {
        id: 'agent-1',
        sessionId: 'agent-session',
        title: 'codex · gpt-5.4',
        position: { x: 40, y: 60 },
        width: 360,
        height: 260,
        kind: 'agent',
        status: 'standby',
        startedAt: '2026-04-13T00:00:00.000Z',
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: 'agent placeholder history',
        agent: {
          provider: 'codex',
          prompt: '',
          model: 'gpt-5.4',
          effectiveModel: 'gpt-5.4',
          launchMode: 'resume',
          resumeSessionId: 'resume-session',
          resumeSessionIdVerified: true,
          executionDirectory: '/tmp/workspace-1',
          expectedDirectory: '/tmp/workspace-1',
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
          taskId: null,
        },
        task: null,
      },
      {
        id: 'note-1',
        title: 'Note',
        position: { x: 80, y: 100 },
        width: 200,
        height: 140,
        kind: 'note',
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        agent: null,
        task: {
          text: 'keep me',
        },
      },
    ],
  }
}

describe('toShellWorkspaceState', () => {
  it('clears runtime session ids and drops agent renderer placeholders on cold start', () => {
    const state = toShellWorkspaceState(createPersistedWorkspace(), {
      dropRuntimeSessionIds: true,
    })

    expect(state.nodes.map(node => [node.id, node.data.sessionId])).toEqual([
      ['terminal-1', ''],
      ['agent-1', ''],
      ['note-1', ''],
    ])
    expect(state.nodes[0]?.data.scrollback).toBe('terminal history')
    expect(state.nodes[1]?.data.scrollback).toBeNull()
    expect(state.nodes[1]?.data.agent?.resumeSessionId).toBe('resume-session')
  })
})
