import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import {
  subscribeWorkspaceNodeCreated,
  subscribeWorkspaceNodeCreationPrepared,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { readDefaultAgentSettings } from '../../support/agentSettingsReader'

const confirm = vi.hoisted(() => ({
  gate: null as null | Promise<unknown>,
}))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeProjection',
  async importOriginal => {
    const actual = await importOriginal<Record<string, unknown>>()
    return {
      ...actual,
      confirmManagedClaudeRuntime: vi.fn(async (_nodeId: string, data: unknown) => {
        await confirm.gate
        return data
      }),
    }
  },
)

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title: id })],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

function renderStore(initialWorkspaceId: string) {
  const provided = { workspaceId: initialWorkspaceId }
  const view = renderHook(
    ({ workspaceId }: { workspaceId: string }) => {
      const nodes = useAppStore(
        state => state.workspaces.find(candidate => candidate.id === workspaceId)!.nodes,
      )
      return useWorkspaceCanvasNodesStore({
        workspaceId,
        workspacePath: `/tmp/${workspaceId}`,
        nodes,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
        readAgentSettings: readDefaultAgentSettings,
      })
    },
    {
      initialProps: { workspaceId: initialWorkspaceId },
      wrapper: ({ children }) => (
        <CanvasStoreTestProvider workspaceId={provided.workspaceId}>
          <ReactFlowProvider>{children}</ReactFlowProvider>
        </CanvasStoreTestProvider>
      ),
    },
  )
  return {
    ...view,
    rerender: (props: { workspaceId: string }) => {
      provided.workspaceId = props.workspaceId
      view.rerender(props)
    },
  }
}

type Store = ReturnType<typeof renderStore>['result']['current']

const ANCHOR = { x: 400, y: 400 }
const BINDING = { kind: 'local' } as never
const FOLDER = {
  uri: 'file:///tmp/a',
  rootUri: 'file:///tmp/a',
  viewMode: 'icons' as const,
  expandedDirectoryUris: [],
}
const ROLE = {
  id: 'role-1',
  name: 'Role',
  description: '',
  promptTemplate: '',
  inputHint: '',
  outputFormat: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// One call of each creator that writes a window to the document, by name.
const CREATORS: ReadonlyArray<readonly [string, (store: Store) => Promise<{ id: string } | null>]> =
  [
    [
      'createNodeForSession',
      store =>
        store.createNodeForSession({
          sessionId: 's',
          title: 'T',
          anchor: ANCHOR,
          kind: 'terminal',
        }),
    ],
    ['createNoteNode', async store => store.createNoteNode(ANCHOR)],
    [
      'createTaskNode',
      async store => store.createTaskNode(ANCHOR, 'Task', 'Do', false, 'medium', []),
    ],
    ['createRoleNode', async store => store.createRoleNode(ANCHOR, ROLE)],
    [
      'createImageNode',
      async store =>
        store.createImageNode(ANCHOR, {
          mimeType: 'image/png',
          assetPath: 'a.png',
          fileName: 'a.png',
          naturalWidth: 10,
          naturalHeight: 10,
        } as never),
    ],
    [
      'createDocumentNode',
      async store =>
        store.createDocumentNode(ANCHOR, { uri: 'file:///tmp/a.md' }, undefined, BINDING),
    ],
    [
      'createFolderNode',
      async store => store.createFolderNode(ANCHOR, FOLDER, BINDING, 'workspace-a'),
    ],
    [
      'createWebsiteNode',
      async store => store.createWebsiteNode(ANCHOR, { url: 'https://example.com' } as never),
    ],
  ]

describe('the creators write through the created-node publisher, for the workspace of their render', () => {
  beforeEach(() => {
    confirm.gate = null
    useAppStore.setState({
      workspaces: [workspace('workspace-a'), workspace('workspace-b')],
      activeWorkspaceId: 'workspace-a',
    })
  })
  afterEach(() => {
    cleanup()
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null })
  })

  it.each(CREATORS)(
    '%s publishes its window once, prepared before it is committed',
    async (_name, create) => {
      const prepared: string[][] = []
      const created: string[] = []
      const stopPrepared = subscribeWorkspaceNodeCreationPrepared(ids => prepared.push([...ids]))
      const stopCreated = subscribeWorkspaceNodeCreated(id => created.push(id))
      try {
        const view = renderStore('workspace-a')
        let node: { id: string } | null = null
        await act(async () => {
          node = await create(view.result.current)
        })
        expect(node).not.toBeNull()
        expect(useAppStore.getState().workspaces[0].nodes.map(n => n.id)).toContain(node!.id)
        expect(prepared).toEqual([[node!.id]])
        expect(created).toEqual([node!.id])
      } finally {
        stopPrepared()
        stopCreated()
      }
    },
  )

  it.each(CREATORS)(
    '%s, called after a switch to B, writes A and leaves B untouched',
    async (_name, create) => {
      const view = renderStore('workspace-a')
      const storeOfA = view.result.current
      act(() => {
        useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
      })
      view.rerender({ workspaceId: 'workspace-b' })
      const workspaceBBefore = useAppStore.getState().workspaces[1]

      let node: { id: string } | null = null
      await act(async () => {
        node = await create(storeOfA)
      })

      const [workspaceA, workspaceB] = useAppStore.getState().workspaces
      expect(workspaceA.nodes.map(n => n.id)).toContain(node!.id)
      expect(workspaceB).toBe(workspaceBBefore)
    },
  )

  it('a creation that awaits and finishes after the switch writes A', async () => {
    let release: () => void = () => undefined
    confirm.gate = new Promise<void>(resolve => {
      release = resolve
    })
    const view = renderStore('workspace-a')
    const storeOfA = view.result.current
    let pending: Promise<{ id: string } | null> = Promise.resolve(null)
    await act(async () => {
      pending = storeOfA.createNodeForSession({
        sessionId: 's',
        title: 'T',
        anchor: ANCHOR,
        kind: 'agent',
        managedClaudeLifecycle: { binding: {} } as never,
      })
    })
    act(() => {
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
    })
    view.rerender({ workspaceId: 'workspace-b' })
    const workspaceBBefore = useAppStore.getState().workspaces[1]

    await act(async () => {
      release()
      await pending
    })

    const node = await pending
    expect(node).not.toBeNull()
    const [workspaceA, workspaceB] = useAppStore.getState().workspaces
    expect(workspaceA.nodes.map(n => n.id)).toContain(node!.id)
    expect(workspaceB).toBe(workspaceBBefore)
  })
})
