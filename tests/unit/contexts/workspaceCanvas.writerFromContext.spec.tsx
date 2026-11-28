import { act } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasImageImport } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasImageImport'
import { useWorkspaceCanvasPasteHandlers } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.pasteHandlers'
import { useWebsiteWindowOpenUrlNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWebsiteWindowOpenUrlNodeCreation'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { WEBSITE_WINDOW_OPEN_URL_EVENT_NAME } from '../../../src/shared/contracts/websiteWindowCanvas'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'
import { setDocumentNodes } from '../../support/documentNodes'

// S7 PR 9 (#647): a hook that creates a window after an await, or from an event, takes the node
// writer from context and no longer receives it as a parameter. The writer is the one of the render
// that made the hook, so a creation that was started in workspace A and finishes after the user has
// shown B assigns the window to A's Space and leaves B alone, and a creation after the switch
// writes B. The creators are stand-ins that add the window to the store of the workspace they were
// made for, as the node store's creators do.

vi.mock('@app/renderer/i18n', () => {
  const translation = { t: (key: string) => key }
  return { useTranslation: () => translation }
})

const A = 'workspace-a'
const B = 'workspace-b'
const SPACE_RECT = { x: 0, y: 0, width: 1000, height: 800 }
const INSIDE = { x: 300, y: 300 }

const documentOf = (id: string) =>
  useAppStore.getState().workspaces.find(workspace => workspace.id === id)!

function seedTwoWorkspaces() {
  createCanvasDocumentHarness({
    workspaceId: A,
    nodes: createRowNodes(['a-1']),
    spaces: [createSpace('space-a', SPACE_RECT)],
  })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      {
        ...state.workspaces[0],
        id: B,
        nodes: createRowNodes(['b-1']),
        spaces: [createSpace('space-b', SPACE_RECT)] as WorkspaceSpaceState[],
      },
    ],
  }))
}

/** A creator for `workspaceId`: adds a window to its document and returns it. */
function creatorFor(workspaceId: string, id: string) {
  return vi.fn((): Node<TerminalNodeData> | null => {
    const node = { ...createRowNodes([id])[0], position: INSIDE }
    setDocumentNodes(workspaceId, [...documentOf(workspaceId).nodes, node])
    return node
  })
}

const reactFlow = {
  screenToFlowPosition: (point: { x: number; y: number }) => point,
} as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>

function showing() {
  let shown = A
  return {
    workspaceId: () => shown,
    show: (id: string) => {
      shown = id
    },
  }
}

afterEach(() => {
  delete (window as { opencoveApi?: unknown }).opencoveApi
})

beforeEach(() => {
  seedTwoWorkspaces()
})

describe('image import', () => {
  function pngFile() {
    return {
      type: 'image/png',
      size: 4,
      name: 'a.png',
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as File
  }

  it('assigns an image that finished in A, after B is shown, to the Space of A', async () => {
    let finishWrite: () => void = () => undefined
    const writeCanvasImage = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishWrite = resolve
        }),
    )
    window.opencoveApi = { workspace: { writeCanvasImage } } as never
    const createImageNode = creatorFor(A, 'image-a')
    const control = showing()
    const view = renderInCanvasDocument(
      () =>
        useWorkspaceCanvasImageImport({
          workspaceId: A,
          canvasRef: { current: null },
          reactFlow,
          createImageNode,
          standardWindowSizeBucket: 'regular',
        }),
      { workspaceId: control.workspaceId },
    )
    const handlersOfA = view.result.current

    act(() => {
      handlersOfA.handleCanvasDrop({
        dataTransfer: { files: [pngFile()] },
        clientX: INSIDE.x,
        clientY: INSIDE.y,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      } as never)
    })
    await vi.waitFor(() => expect(writeCanvasImage).toHaveBeenCalledTimes(1))
    control.show(B)
    useAppStore.setState({ activeWorkspaceId: B })
    view.rerender()
    const workspaceBBefore = documentOf(B)
    await act(async () => {
      finishWrite()
      await vi.waitFor(() => expect(createImageNode).toHaveBeenCalledTimes(1))
    })

    await vi.waitFor(() => expect(documentOf(A).spaces[0].nodeIds).toEqual(['image-a']))
    expect(documentOf(B)).toBe(workspaceBBefore)
  })
})

describe('website open-url event', () => {
  function openUrl() {
    window.dispatchEvent(
      new CustomEvent(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, {
        detail: { type: 'open-url', url: 'https://example.com', sourceNodeId: 'gone' },
      }),
    )
  }

  it('assigns the window to the Space of the workspace that is shown', () => {
    const createInA = creatorFor(A, 'site-a')
    const createInB = creatorFor(B, 'site-b')
    const control = showing()
    const view = renderInCanvasDocument(
      () =>
        useWebsiteWindowOpenUrlNodeCreation({
          workspaceId: control.workspaceId(),
          canvasRef: { current: document.createElement('div') },
          reactFlow,
          createWebsiteNode: control.workspaceId() === A ? createInA : createInB,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'iframe',
          enabled: true,
        }),
      { workspaceId: control.workspaceId },
    )

    act(() => openUrl())
    expect(documentOf(A).spaces[0].nodeIds).toEqual(['site-a'])

    control.show(B)
    useAppStore.setState({ activeWorkspaceId: B })
    view.rerender()
    const workspaceABefore = documentOf(A)
    act(() => openUrl())

    expect(documentOf(B).spaces[0].nodeIds).toEqual(['site-b'])
    expect(documentOf(A)).toBe(workspaceABefore)
    view.unmount()
  })
})

describe('website paste', () => {
  it('assigns a pasted address to the Space of the workspace that is shown', () => {
    const createInB = creatorFor(B, 'pasted-b')
    const control = showing()
    const view = renderInCanvasDocument(
      () =>
        useWorkspaceCanvasPasteHandlers({
          workspaceId: control.workspaceId(),
          canvasRef: { current: null },
          reactFlow: {
            ...reactFlow,
            screenToFlowPosition: () => INSIDE,
          } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>,
          createImageNode: () => null,
          createWebsiteNode: control.workspaceId() === A ? creatorFor(A, 'pasted-a') : createInB,
          standardWindowSizeBucket: 'regular',
          browserDefaultMode: 'iframe',
          websiteWindowsEnabled: true,
          websiteWindowPasteEnabled: true,
        }),
      { workspaceId: control.workspaceId },
    )
    control.show(B)
    useAppStore.setState({ activeWorkspaceId: B })
    view.rerender()
    const workspaceABefore = documentOf(A)

    act(() => {
      view.result.current.handleCanvasPaste({
        clipboardData: { getData: () => 'https://example.com', files: [], items: [] },
        target: document.createElement('div'),
        defaultPrevented: false,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      } as never)
    })

    expect(documentOf(B).spaces[0].nodeIds).toEqual(['pasted-b'])
    expect(documentOf(A)).toBe(workspaceABefore)
  })
})
