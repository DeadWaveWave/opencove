import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { resolveDefaultWebsiteWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { useWorkspaceCanvasQuickMenuActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.quickMenuActions'
import { useWorkspaceCanvasTerminalCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.terminalCreation'
import { useWebsiteWindowOpenUrlNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWebsiteWindowOpenUrlNodeCreation'
import { useCanvasUiCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'

import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { WEBSITE_WINDOW_OPEN_URL_EVENT_NAME } from '../../../src/shared/contracts/websiteWindowCanvas'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'
import { setDocumentNodes } from '../../support/documentNodes'

// The node creation paths of the pane read the committed document of the workspace whose render made
// the callback, when they run (#702, PR 7). Each case writes the store in the same call, before the
// read, or switches the workspace in the middle of it: a read of a ref, a captured array or the
// displayed workspace gives another answer.

const metrics = { fontSize: 13 }

function seedTwoWorkspaces(a: Node<TerminalNodeData>[], b: Node<TerminalNodeData>[]) {
  const harness = createCanvasDocumentHarness({ workspaceId: 'workspace-a', nodes: a })
  useAppStore.setState(state => ({
    workspaces: [...state.workspaces, { ...state.workspaces[0], id: 'workspace-b', nodes: b }],
  }))
  return harness
}

function stubTerminalApi(spawn: () => Promise<unknown>) {
  const api = {
    pty: {
      spawn: vi.fn(spawn),
      attach: vi.fn(async () => undefined),
      write: vi.fn(async () => {}),
    },
  }
  vi.stubGlobal('opencoveApi', api)
  return api
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the default title of a pane terminal', () => {
  it('counts the nodes of the workspace of the callback, as the store holds them after the spawn', async () => {
    seedTwoWorkspaces(createRowNodes(['a1', 'a2']), createRowNodes(['b1', 'b2', 'b3', 'b4', 'b5']))
    let finishSpawn!: (result: unknown) => void
    const api = stubTerminalApi(() => new Promise(resolve => (finishSpawn = resolve)))
    const createNodeForSession = vi.fn(async () => null)
    let shown = 'workspace-a'
    const view = renderInCanvasDocument(
      () =>
        useWorkspaceCanvasTerminalCreation({
          workspaceId: 'workspace-a',
          workspacePath: '/repo',
          defaultTerminalProfileId: null,
          standardWindowSizeBucket: 'regular',
          terminalFontSize: 13,
          terminalDisplayMetrics: metrics,
          createNodeForSession,
          updateCanvasDocument: vi.fn(),
        }),
      { workspaceId: () => shown },
    )
    const createInA = view.result.current.createTerminalNodeAtFlowPoint

    let creation!: Promise<void>
    act(() => {
      creation = createInA({ x: 10, y: 10 })
    })
    await vi.waitFor(() => expect(api.pty.spawn).toHaveBeenCalledTimes(1))

    // The workspace shown changes while the spawn is pending, and a node reaches A's store. The app
    // store's active workspace moves with the provider, as in the app, so a title counted from the
    // displayed workspace (what `nodesRef` held) fails.
    act(() => {
      shown = 'workspace-b'
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
      view.rerender()
    })
    act(() => {
      setDocumentNodes('workspace-a', createRowNodes(['a1', 'a2', 'a3']))
    })
    await act(async () => {
      finishSpawn({ sessionId: 'session-1', profileId: null, runtimeKind: 'posix' })
      await creation
    })

    // A holds three nodes now: B's five, and the two A held when the click came, both differ.
    expect(createNodeForSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'terminal-4' }),
    )
  })
})

describe('the website opened from a website window', () => {
  it('anchors to a source node that another writer added to the store in the same call', async () => {
    createCanvasDocumentHarness({ workspaceId: 'workspace-a' })
    const createWebsiteNode = vi.fn(() => null)
    renderInCanvasDocument(
      () =>
        useWebsiteWindowOpenUrlNodeCreation({
          workspaceId: 'workspace-a',
          canvasRef: { current: document.createElement('div') },
          reactFlow: { screenToFlowPosition: () => ({ x: -9999, y: -9999 }) } as never,
          updateCanvasDocument: vi.fn(),
          createWebsiteNode,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'iframe',
          enabled: true,
        }),
      { workspaceId: 'workspace-a' },
    )
    const source: Node<TerminalNodeData> = {
      ...createRowNodes(['source'])[0],
      position: { x: 100, y: 50 },
      width: 300,
      height: 200,
    }

    act(() => {
      setDocumentNodes('workspace-a', [source])
      window.dispatchEvent(
        new CustomEvent(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, {
          detail: { type: 'open-url', url: 'https://example.com', sourceNodeId: 'source' },
        }),
      )
    })

    // The website is placed by its top left corner: its centre is 48 px right of the source.
    const size = resolveDefaultWebsiteWindowSize('regular')
    expect(createWebsiteNode).toHaveBeenCalledTimes(1)
    const [anchor] = createWebsiteNode.mock.calls[0] as unknown as [{ x: number; y: number }]
    expect(anchor.x + size.width / 2).toBe(100 + 300 + 48)
    expect(anchor.y + size.height / 2).toBe(50 + 200 / 2)
  })
})

describe('the quick command', () => {
  const PANE_MENU = { kind: 'pane', x: 20, y: 20, flowX: 400, flowY: 300 } as const

  function setup() {
    createCanvasDocumentHarness({ workspaceId: 'workspace-a' })
    const api = stubTerminalApi(async () => ({
      sessionId: 'session-1',
      profileId: null,
      runtimeKind: 'posix',
    }))
    // The created node reaches the store at once, as a node written by a runtime observation or a
    // sync would: the canvas view has not seen it when the command checks for it.
    const createNodeForSession = vi.fn(async (input: { nodeId?: string; sessionId?: string }) => {
      const node = {
        ...createRowNodes([input.nodeId ?? 'created'])[0],
        data: { ...createRowNodes(['x'])[0].data, kind: 'terminal', sessionId: input.sessionId },
      } as Node<TerminalNodeData>
      setDocumentNodes('workspace-a', [node])
      return node
    })
    const view = renderInCanvasDocument(
      () => ({
        ui: useCanvasUiCommands(),
        quick: useWorkspaceCanvasQuickMenuActions({
          workspaceId: 'workspace-a',
          websiteWindowsEnabled: true,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'iframe',
          createWebsiteNode: vi.fn(() => null),
          createNoteNode: vi.fn(() => null),
          updateCanvasDocument: vi.fn(),
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: metrics,
          workspacePath: '/repo',
          createNodeForSession: createNodeForSession as never,
        }),
      }),
      { workspaceId: 'workspace-a' },
    )
    act(() => view.result.current.ui.openContextMenu(PANE_MENU))
    return { api, view }
  }

  const command = { kind: 'command', command: 'ls', title: 'ls' } as never

  it('writes to the PTY when the created node is in the store and the canvas has not seen it', async () => {
    const { api, view } = setup()

    await act(async () => {
      await view.result.current.quick.runQuickCommand(command)
    })

    expect(api.pty.attach).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(api.pty.write).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-1', data: 'ls\r' })
  })

  it('does not write when the node leaves the store while attach is pending', async () => {
    const { api, view } = setup()
    api.pty.attach.mockImplementationOnce(async () => {
      setDocumentNodes('workspace-a', [])
    })

    await act(async () => {
      await view.result.current.quick.runQuickCommand(command)
    })

    expect(api.pty.attach).toHaveBeenCalledTimes(1)
    expect(api.pty.write).not.toHaveBeenCalled()
  })
})
