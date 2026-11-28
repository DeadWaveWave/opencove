import { act } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceCanvasAgentLauncher } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentLauncher'
import { useWorkspaceCanvasImageImport } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasImageImport'
import { useWorkspaceCanvasPasteHandlers } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.pasteHandlers'
import { useWorkspaceCanvasQuickMenuActions } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.quickMenuActions'
import { useWorkspaceCanvasTerminalCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.terminalCreation'
import { useWorkspaceCanvasApplyOwnershipForDrop } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.applyDrop'
import { useWorkspaceCanvasCreateChildSpace } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces.createChildSpace'
import { useWorkspaceCanvasCreateSpace } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaces.createSpace'
import {
  useCanvasSelectionCommands,
  useCanvasUiCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import { useWebsiteWindowOpenUrlNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWebsiteWindowOpenUrlNodeCreation'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { WEBSITE_WINDOW_OPEN_URL_EVENT_NAME } from '../../../src/shared/contracts/websiteWindowCanvas'
import { renderInTwoWorkspaces, type RuntimeCanvasContext } from '../../support/agentRuntimeHarness'
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
//
// The two blocks at the end use the real node store's creators and two workspaces that hold the same
// ids (review round): work that awaits (an agent launch, a pane terminal, a quick command, a Space
// from the selection) and finishes after B is shown writes A, and the render that shows B writes B
// (a drop, a child Space). A write that reached the wrong workspace would change it.

// `t` is stable, as in the app.
const translation = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => translation,
  translate: (key: string) => key,
}))

const gates = vi.hoisted(() => ({ launch: null as null | { promise: Promise<void> } }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared',
  async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveWorkspaceAgentLaunchBinding: vi.fn(async () => ({
      mountId: null,
      executionDirectory: '/tmp/repo',
    })),
    launchWorkspaceAgentSession: vi.fn(async () => {
      await gates.launch?.promise
      return {
        sessionId: 'launched',
        profileId: null,
        runtimeKind: 'posix',
        workerBinding: null,
        effectiveModel: null,
        executionDirectory: '/tmp/repo',
        resumeSessionId: null,
      }
    }),
  }),
)

const A = 'workspace-a'
const B = 'workspace-b'
const SPACE_RECT = { x: 0, y: 0, width: 1000, height: 800 }
const INSIDE = { x: 300, y: 300 }

const documentOf = (id: string) =>
  useAppStore.getState().workspaces.find(workspace => workspace.id === id)!

function hold() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function seedSpaceWithTwoNodes(): {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
} {
  const [n1, n2] = createRowNodes(['n-1', 'n-2'])
  return {
    nodes: [
      {
        ...n1,
        position: { x: 0, y: 0 },
        initialWidth: n1.data.width,
        initialHeight: n1.data.height,
      },
      {
        ...n2,
        position: { x: 1400, y: 0 },
        initialWidth: n2.data.width,
        initialHeight: n2.data.height,
      },
    ],
    spaces: [{ ...createSpace('space-1', SPACE_RECT, ['n-1']), directoryPath: '/tmp/repo' }],
  }
}

function useReactFlowFor(workspaceId: string) {
  return useMemo(() => {
    const nodes = () => readWorkspaceDocument(workspaceId)?.nodes ?? []
    return {
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      flowToScreenPosition: (p: { x: number; y: number }) => p,
      getNode: (id: string) => nodes().find(n => n.id === id),
      getNodes: nodes,
      getZoom: () => 1,
    }
  }, [workspaceId]) as never
}

const docOf = (id: string) => readWorkspaceDocument(id)!
const newIds = (id: string) =>
  docOf(id)
    .nodes.map(node => node.id)
    .filter(nodeId => nodeId !== 'n-1' && nodeId !== 'n-2')

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

function renderBoth<Result>(useHook: (ctx: RuntimeCanvasContext) => Result) {
  return renderInTwoWorkspaces(useHook, { a: seedSpaceWithTwoNodes(), b: seedSpaceWithTwoNodes() })
}

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

describe('image import', () => {
  beforeEach(() => {
    seedTwoWorkspaces()
  })

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
  beforeEach(() => {
    seedTwoWorkspaces()
  })

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
  beforeEach(() => {
    seedTwoWorkspaces()
  })

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

describe('work started in A that finishes after B is shown writes A', () => {
  beforeEach(() => {
    gates.launch = null
  })

  it('joins the agent of a launch whose session started after the switch to the Space of A', async () => {
    const launch = hold()
    gates.launch = launch
    const view = renderBoth(ctx =>
      useWorkspaceCanvasAgentLauncher({
        readAgentSettings: () => DEFAULT_AGENT_SETTINGS,
        workspaceId: ctx.workspaceId,
        workspacePath: '/tmp/repo',
        onShowMessage: vi.fn(),
        createNodeForSession: ctx.nodeStore.createNodeForSession,
        buildAgentNodeTitle: () => 'Agent',
      }),
    )
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = view.view.result.current.launchAgentAtFlowPosition({ x: 300, y: 300 })
    })
    await settle()
    view.showB()
    const nodesOfB = docOf(B).nodes
    const spacesOfB = docOf(B).spaces

    await act(async () => {
      launch.resolve()
      await done
    })

    expect(newIds(A)).toHaveLength(1)
    expect(docOf(A).spaces[0].nodeIds).toEqual(['n-1', newIds(A)[0]])
    expect(docOf(B).nodes).toBe(nodesOfB)
    expect(docOf(B).spaces).toBe(spacesOfB)
  })

  it('joins a pane terminal whose spawn answered after the switch to the Space of A', async () => {
    const spawned = hold()
    const spawn = vi.fn(async () => {
      await spawned.promise
      return { sessionId: 'spawned', profileId: null, runtimeKind: 'posix' }
    })
    window.opencoveApi = { pty: { spawn } } as never
    const view = renderBoth(ctx =>
      useWorkspaceCanvasTerminalCreation({
        workspaceId: ctx.workspaceId,
        workspacePath: '/tmp/repo',
        defaultTerminalProfileId: null,
        standardWindowSizeBucket: 'regular',
        terminalFontSize: 13,
        terminalDisplayMetrics: null as never,
        createNodeForSession: ctx.nodeStore.createNodeForSession,
        onShowMessage: vi.fn(),
      }),
    )
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = view.view.result.current.createTerminalNodeAtFlowPoint({ x: 300, y: 300 })
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    view.showB()
    const nodesOfB = docOf(B).nodes
    const spacesOfB = docOf(B).spaces

    await act(async () => {
      spawned.resolve()
      await done
    })

    expect(newIds(A)).toHaveLength(1)
    expect(docOf(A).spaces[0].nodeIds).toEqual(['n-1', newIds(A)[0]])
    expect(docOf(B).nodes).toBe(nodesOfB)
    expect(docOf(B).spaces).toBe(spacesOfB)
  })

  it('joins the terminal of a quick command whose spawn answered after the switch to the Space of A', async () => {
    const spawned = hold()
    const spawn = vi.fn(async () => {
      await spawned.promise
      return { sessionId: 'spawned', profileId: null, runtimeKind: 'posix' }
    })
    window.opencoveApi = {
      pty: { spawn, attach: vi.fn(async () => undefined), write: vi.fn(async () => undefined) },
    } as never
    const view = renderBoth(ctx => ({
      ui: useCanvasUiCommands(),
      quick: useWorkspaceCanvasQuickMenuActions({
        workspaceId: ctx.workspaceId,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
        createWebsiteNode: ctx.nodeStore.createWebsiteNode,
        createNoteNode: ctx.nodeStore.createNoteNode,
        defaultTerminalProfileId: null,
        terminalFontSize: 13,
        terminalDisplayMetrics: null as never,
        workspacePath: '/tmp/repo',
        createNodeForSession: ctx.nodeStore.createNodeForSession,
        onShowMessage: vi.fn(),
        websiteWindowsEnabled: true,
      }),
    }))
    const ofA = view.view.result.current
    act(() =>
      ofA.ui.openContextMenu({ kind: 'pane', x: 20, y: 20, flowX: 300, flowY: 300 } as never),
    )
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = ofA.quick.runQuickCommand({ kind: 'command', command: 'ls', title: 'ls' } as never)
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    view.showB()
    const nodesOfB = docOf(B).nodes
    const spacesOfB = docOf(B).spaces

    await act(async () => {
      spawned.resolve()
      await done
    })

    expect(newIds(A)).toHaveLength(1)
    expect(docOf(A).spaces[0].nodeIds).toEqual(['n-1', newIds(A)[0]])
    expect(docOf(B).nodes).toBe(nodesOfB)
    expect(docOf(B).spaces).toBe(spacesOfB)
  })

  it('creates the Space of a selection whose mounts answered after the switch in A, and the next one in B', async () => {
    const answered = hold()
    const invoke = vi.fn(async () => {
      await answered.promise
      return {
        mounts: [
          {
            mountId: 'm1',
            projectId: A,
            name: 'repo',
            sortOrder: 0,
            endpointId: 'local',
            targetId: 't',
            rootPath: '/tmp/repo',
            rootUri: 'file:///tmp/repo',
            createdAt: '',
            updatedAt: '',
          },
        ],
      }
    })
    window.opencoveApi = { controlSurface: { invoke } } as never
    const view = renderBoth(ctx => ({
      selection: useCanvasSelectionCommands(),
      create: useWorkspaceCanvasCreateSpace({
        workspaceId: ctx.workspaceId,
        workspacePath: '/tmp/repo',
        standardWindowSizeBucket: 'regular',
        reactFlow: useReactFlowFor(ctx.workspaceId),
        onShowMessage: vi.fn(),
        createChildSpaceInParent: () => null,
      }),
    }))
    act(() => view.view.result.current.selection.select({ nodeIds: ['n-2'], spaceIds: [] }))
    act(() => view.view.result.current.create.createSpaceFromSelectedNodes())
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    view.showB()
    const nodesOfB = docOf(B).nodes
    const spacesOfB = docOf(B).spaces

    await act(async () => {
      answered.resolve()
    })
    await settle()

    expect(docOf(A).spaces.map(space => space.nodeIds)).toEqual([['n-1'], ['n-2']])
    expect(docOf(B).nodes).toBe(nodesOfB)
    expect(docOf(B).spaces).toBe(spacesOfB)

    // The render that shows B creates its Spaces in B.
    const spacesOfA = docOf(A).spaces
    act(() =>
      view.view.result.current.create.createSpaceWithTargetMount({
        nodeIds: ['n-2'],
        rect: null,
        targetMountId: 'm1',
        directoryPath: '/tmp/repo',
      }),
    )
    expect(docOf(B).spaces.map(space => space.nodeIds)).toEqual([['n-1'], ['n-2']])
    expect(docOf(A).spaces).toBe(spacesOfA)
  })
})

describe('the render that shows B writes B', () => {
  it('drops a window in B, from the render that shows B, into the Space of B', async () => {
    const view = renderBoth(ctx => {
      const flow = useReactFlowFor(ctx.workspaceId)
      return useWorkspaceCanvasApplyOwnershipForDrop({
        workspaceId: ctx.workspaceId,
        workspacePath: '/tmp/repo',
        reactFlow: flow,
        onShowMessage: vi.fn(),
        resolveSpaceAtPoint: point =>
          (readWorkspaceDocument(ctx.workspaceId)?.spaces ?? []).find(
            space =>
              space.rect !== null &&
              point.x >= space.rect.x &&
              point.y >= space.rect.y &&
              point.x <= space.rect.x + space.rect.width &&
              point.y <= space.rect.y + space.rect.height,
          ) ?? null,
        t: translation.t as never,
      })
    })
    view.showB()
    const nodesOfA = docOf(A).nodes
    const spacesOfA = docOf(A).spaces

    act(() =>
      view.view.result.current({
        draggedNodeIds: ['n-2'],
        draggedNodePositionById: new Map([['n-2', { x: 300, y: 300 }]]),
        dragStartNodePositionById: new Map([['n-2', { x: 1400, y: 0 }]]),
        dropFlowPoint: { x: 450, y: 400 },
      }),
    )

    expect(docOf(B).spaces[0].nodeIds).toEqual(['n-1', 'n-2'])
    expect(docOf(A).nodes).toBe(nodesOfA)
    expect(docOf(A).spaces).toBe(spacesOfA)
  })

  it('creates a child Space in B, from the render that shows B', () => {
    const view = renderBoth(() =>
      useWorkspaceCanvasCreateChildSpace({ workspacePath: '/tmp/repo', onShowMessage: vi.fn() }),
    )
    view.showB()
    const nodesOfA = docOf(A).nodes
    const spacesOfA = docOf(A).spaces

    let created: string | null = null
    act(() => {
      created = view.view.result.current.createChildSpaceInParent('space-1', { nodeIds: ['n-1'] })
    })

    expect(docOf(B).spaces.map(space => space.id)).toEqual(['space-1', created])
    expect(docOf(A).nodes).toBe(nodesOfA)
    expect(docOf(A).spaces).toBe(spacesOfA)
  })
})
