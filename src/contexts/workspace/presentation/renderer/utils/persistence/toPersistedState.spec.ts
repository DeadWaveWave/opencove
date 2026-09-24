import { describe, expect, it, afterEach } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceState } from '../../types'
import { useCanvasCollapseStore } from '../../store/useCanvasCollapseStore'
import { toPersistedState } from './toPersistedState'

function node(id: string): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    type: 'terminalNode',
    data: {
      sessionId: `session-${id}`,
      title: id,
      kind: 'terminal',
      width: 640,
      height: 480,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

const workspace = (): WorkspaceState => ({
  id: 'workspace-persisted',
  name: 'Workspace',
  path: '/tmp/workspace',
  worktreesRoot: '',
  nodes: [node('terminal')],
  viewport: { x: 0, y: 0, zoom: 1 },
  isMinimapVisible: true,
  spaces: [],
  activeSpaceId: null,
  spaceArchiveRecords: [],
})

describe('toPersistedState canvas disclosure preferences', () => {
  afterEach(() => {
    useCanvasCollapseStore.setState({ workspaces: {} })
  })

  it('stores compact IDs on the workspace envelope instead of node data', () => {
    useCanvasCollapseStore.setState({
      workspaces: {
        'workspace-persisted': {
          collapsedNodeIds: { terminal: true },
          collapsedSpaceIds: {},
        },
      },
    })

    const persisted = toPersistedState([workspace()], 'workspace-persisted')
    const persistedWorkspace = persisted.workspaces[0]
    expect(persistedWorkspace.collapsedNodeIds).toEqual(['terminal'])
    expect(persistedWorkspace.collapsedSpaceIds).toEqual([])
    expect(persistedWorkspace.nodes[0]).not.toHaveProperty('collapsedNodeIds')
  })
})
