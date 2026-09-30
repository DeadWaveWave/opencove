import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceState } from '../../types'
import { ensurePersistedWorkspace } from './ensure'
import { toPersistedState } from './toPersistedState'
import { toRuntimeNodes } from '../nodeTransform'

function pluginNode(): Node<TerminalNodeData> {
  return {
    id: 'git-board-node',
    position: { x: 120, y: 80 },
    type: 'pluginNode',
    data: {
      sessionId: '',
      title: 'Git Board',
      kind: 'plugin',
      width: 420,
      height: 520,
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
      folder: null,
      website: null,
      plugin: {
        pluginId: 'git-board',
        schemaVersion: 1,
        repoPath: '/Users/example/Project with spaces',
        mountId: 'mount-remote-1',
        graphLimit: 50,
      },
    },
  }
}

function workspace(): WorkspaceState {
  return {
    id: 'workspace-plugin-persistence',
    name: 'Plugin workspace',
    path: '/Users/example/Project with spaces',
    worktreesRoot: '',
    nodes: [pluginNode()],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('Plugin node persistence', () => {
  it('round trips plugin target and view preferences through persisted state', () => {
    const persisted = toPersistedState([workspace()], 'workspace-plugin-persistence')
    const normalized = ensurePersistedWorkspace(persisted.workspaces[0])
    expect(normalized).not.toBeNull()

    const runtime = toRuntimeNodes(normalized!)
    expect(runtime[0]?.data.plugin).toEqual({
      pluginId: 'git-board',
      schemaVersion: 1,
      repoPath: '/Users/example/Project with spaces',
      mountId: 'mount-remote-1',
      graphLimit: 50,
    })
    expect(runtime[0]?.type).toBe('pluginNode')
  })

  it('preserves unavailable identities and newer data versions without substituting a bundled implementation', () => {
    const original = workspace()
    original.nodes[0]!.data.plugin = {
      ...original.nodes[0]!.data.plugin!,
      pluginId: 'another-plugin',
      schemaVersion: 3,
      graphLimit: 150,
      filters: { refs: ['main', 'feature/new'], showTags: true },
    }
    const persisted = toPersistedState([original], original.id)
    const normalized = ensurePersistedWorkspace(persisted.workspaces[0])!
    const runtime = toRuntimeNodes(normalized)

    expect(runtime[0]?.data.plugin).toEqual(original.nodes[0]!.data.plugin)
    expect(runtime[0]?.data.width).toBe(original.nodes[0]!.data.width)
    expect(runtime[0]?.position).toEqual(original.nodes[0]!.position)
  })
  it('does not invent example preferences for a generic node', () => {
    const original = workspace()
    original.nodes[0]!.data.plugin = {
      pluginId: 'sample-plugin',
      schemaVersion: 1,
      repoPath: '',
      mountId: null,
    }
    const persisted = toPersistedState([original], original.id)
    const normalized = ensurePersistedWorkspace(persisted.workspaces[0])!
    expect(toRuntimeNodes(normalized)[0]?.data.plugin).toEqual(original.nodes[0]!.data.plugin)
  })
})
