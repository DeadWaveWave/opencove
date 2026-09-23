import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  FolderNodeData,
  TerminalNodeData,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { normalizeFolderNodeData } from '@shared/utils/folderNodeData'
import { isPersistedNode } from '@shared/sync/persistedNodeValidation'
import { isNodeEquivalent } from '@app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync.equality'
import { toShellWorkspaceStateForSync } from '@app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import { requiresRuntimeHydration } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { applyDirectoryExpectationForDrop } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.helpers'

function folderNode(folder: Partial<FolderNodeData> = {}): Node<TerminalNodeData> {
  return {
    id: 'folder-stable',
    type: 'folderNode',
    position: { x: 30, y: 70 },
    data: {
      sessionId: '',
      title: 'design',
      width: 480,
      height: 400,
      kind: 'folder',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      workerBinding: { endpointId: 'remote-worker', mountId: 'remote-mount' },
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
      folder: {
        uri: 'file:///remote/repo/docs/design',
        rootUri: 'file:///remote/repo',
        viewMode: 'list',
        expandedDirectoryUris: ['file:///remote/repo/docs/design/assets'],
        ...folder,
      },
    },
  }
}

function workspace(node = folderNode()): WorkspaceState {
  return {
    id: 'workspace',
    name: 'Workspace',
    path: '/local/repo',
    worktreesRoot: '',
    nodes: [node],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('folder node durable browser state', () => {
  it('round-trips stable identity, navigation, view, expansion and mount without a runtime session', () => {
    const original = workspace()
    const persisted = toPersistedState([original], original.id)
    const normalized = normalizePersistedAppState(persisted)
    const restored = ensurePersistedWorkspace(normalized?.workspaces[0])!
    const [node] = toRuntimeNodes(restored)

    expect(isPersistedNode(persisted.workspaces[0].nodes[0])).toBe(true)
    expect(node.id).toBe('folder-stable')
    expect(node.type).toBe('folderNode')
    expect(node.data.folder).toEqual(original.nodes[0].data.folder)
    expect(node.data.workerBinding).toEqual(original.nodes[0].data.workerBinding)
    expect(node.data.sessionId).toBe('')
    expect(node.data.agent).toBeNull()
    expect(node.data.document).toBeNull()
  })

  it('uses the current directory title after navigation while keeping the same window identity', () => {
    const original = workspace(folderNode({ uri: 'file:///remote/repo/docs' }))
    const persisted = toPersistedState([original], original.id)
    const restored = ensurePersistedWorkspace(persisted.workspaces[0])!

    expect(restored.nodes[0].id).toBe('folder-stable')
    expect(restored.nodes[0].title).toBe('docs')
    expect(toRuntimeNodes(restored)[0].data.title).toBe('docs')
  })

  it('normalizes browser defaults and drops invalid/outside-root expansion entries', () => {
    expect(
      normalizeFolderNodeData({
        uri: 'file:///repo/docs/',
        rootUri: 'file:///repo/',
        expandedDirectoryUris: [
          'file:///repo/docs/assets',
          'file:///repo/docs/assets/',
          'file:///private',
          'file://elsewhere/repo/docs',
          42,
        ],
      }),
    ).toEqual({
      uri: 'file:///repo/docs',
      rootUri: 'file:///repo',
      viewMode: 'icons',
      expandedDirectoryUris: ['file:///repo/docs/assets'],
    })
    expect(normalizeFolderNodeData({ uri: 'file:///private', rootUri: 'file:///repo' })).toBeNull()
  })

  it('rejects malformed new folder payloads at the cross-process boundary', () => {
    const node = toPersistedState([workspace()], 'workspace').workspaces[0].nodes[0]
    expect(isPersistedNode({ ...node, task: null })).toBe(false)
    expect(isPersistedNode({ ...node, task: { ...node.task, viewMode: 'freeform' } })).toBe(false)
    expect(
      isPersistedNode({
        ...node,
        task: { ...node.task, uri: 'file:///remote/repo/%2e%2e/private' },
      }),
    ).toBe(false)
  })

  it('ignores unrecoverable folder payloads without changing valid legacy document nodes', () => {
    const persisted = toPersistedState([workspace()], 'workspace').workspaces[0]
    const original = persisted.nodes[0]
    persisted.nodes = [
      { ...original, task: null },
      {
        ...original,
        id: 'document',
        kind: 'document',
        task: { uri: 'file:///repo/docs/notes.md' },
      },
    ]

    const restored = ensurePersistedWorkspace(persisted)!
    expect(restored.nodes.map(node => node.id)).toEqual(['document'])
    expect(toRuntimeNodes(restored)[0].data.document?.uri).toBe('file:///repo/docs/notes.md')
  })

  it('applies synchronized view/expansion changes even when the folder title is unchanged', () => {
    const existing = workspace()
    const persisted = toPersistedState(
      [workspace(folderNode({ viewMode: 'icons', expandedDirectoryUris: [] }))],
      existing.id,
    ).workspaces[0]
    const merged = toShellWorkspaceStateForSync(persisted, existing)

    expect(merged.nodes[0].id).toBe(existing.nodes[0].id)
    expect(merged.nodes[0].data.folder?.viewMode).toBe('icons')
    expect(merged.nodes[0].data.folder?.expandedDirectoryUris).toEqual([])
    expect(merged.nodes[0].data.workerBinding).toEqual(existing.nodes[0].data.workerBinding)
    expect(isNodeEquivalent(folderNode(), folderNode())).toBe(true)
  })

  it('preserves unavailable remote bindings through restore instead of rebinding locally', () => {
    const original = workspace()
    original.nodes[0].data.workerBinding = { endpointId: 'remote-worker', mountId: null }
    const persisted = toPersistedState([original], original.id)
    const restored = toRuntimeNodes(ensurePersistedWorkspace(persisted.workspaces[0])!)[0]

    expect(restored.data.workerBinding).toEqual({ endpointId: 'remote-worker', mountId: null })
    expect(restored.data.folder).toEqual(original.nodes[0].data.folder)
    expect(requiresRuntimeHydration(restored)).toBe(false)
  })

  it('does not swallow a binding-only sync update when URI and title stay unchanged', () => {
    const existing = workspace()
    const changed = workspace()
    changed.nodes[0].data.workerBinding = { endpointId: 'other-worker', mountId: 'other-mount' }
    const persisted = toPersistedState([changed], existing.id).workspaces[0]
    const merged = toShellWorkspaceStateForSync(persisted, existing)

    expect(merged.nodes[0].data.workerBinding).toEqual(changed.nodes[0].data.workerBinding)
    expect(merged.nodes[0].data.folder).toEqual(existing.nodes[0].data.folder)
  })

  it('keeps filesystem identity and its mount when moving the node into a different Space', () => {
    const original = folderNode()
    let nodes = [original]
    applyDirectoryExpectationForDrop({
      nodeIds: [original.id],
      targetSpace: {
        id: 'local-space',
        name: 'Local',
        directoryPath: '/local/other',
        targetMountId: 'local-mount',
        labelColor: null,
        nodeIds: [],
        rect: null,
      },
      workspacePath: '/local/repo',
      setNodes: updater => {
        nodes = updater(nodes)
      },
    })

    expect(nodes[0]).toBe(original)
    expect(nodes[0].data.workerBinding?.mountId).toBe('remote-mount')
    expect(nodes[0].data.folder?.uri).toBe('file:///remote/repo/docs/design')
  })
})
