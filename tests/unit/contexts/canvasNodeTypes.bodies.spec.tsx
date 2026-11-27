import React, { memo } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { I18nProvider, applyUiLanguage } from '../../../src/app/renderer/i18n'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import { useWorkspaceCanvasNodeTypeParameters } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import {
  useReadCanvasSelection,
  useReadCanvasUi,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'
import { agentNode, taskNode } from '../../support/agentRuntimeHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

// S7 of #647 (review of PR 4): a window body's callbacks, and the Delete key, reach the command
// they are named for, through the mounted canvas (mocks as in `canvasNodeCommands.mountedRenders`).

const counts = vi.hoisted(() => ({
  outer: {} as Record<string, number>,
  leaf: {} as Record<string, number>,
}))
const leafProps = vi.hoisted(() => ({}) as Record<string, Record<string, unknown>>)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/shared/windowCommitProbe',
  async importOriginal => {
    const actual = await importOriginal<Record<string, unknown>>()
    return {
      ...actual,
      useWindowNodeCommitProbe: (inputs: { id: string }) => {
        counts.outer[inputs.id] = (counts.outer[inputs.id] ?? 0) + 1
      },
    }
  },
)

function leafMock(name: string) {
  return async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const actual = await importOriginal()
    return {
      ...actual,
      [name]: (props: Record<string, unknown>) => {
        const key = String(props.nodeId ?? props.id ?? props.title ?? name)
        counts.leaf[key] = (counts.leaf[key] ?? 0) + 1
        leafProps[key] = props
        return null
      },
    }
  }
}
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/NoteNode',
  leafMock('NoteNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/WebsiteNode',
  leafMock('WebsiteNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode',
  leafMock('DocumentNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/FolderNode',
  leafMock('FolderNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/ImageNode',
  leafMock('ImageNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/RoleNode',
  leafMock('RoleNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/TaskNode',
  leafMock('TaskNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/TerminalNode',
  leafMock('TerminalNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/PluginUnavailableNode',
  leafMock('PluginUnavailableNode'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/shared/CanvasNodeWindow',
  leafMock('CanvasNodeWindow'),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation',
  () => ({
    WindowCollapsePresentation: (props: { id: string; children: React.ReactNode }) => {
      leafProps['collapse:' + props.id] = props as never
      return <>{props.children}</>
    },
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
)

const setCenterCalls = vi.hoisted(() => [] as unknown[][])
const rf = vi.hoisted(() => {
  const methods = {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => undefined,
    setCenter: (...args: unknown[]) => {
      setCenterCalls.push(args)
    },
    getNodes: () => [],
    getNode: () => undefined,
  }
  const state: Record<string, unknown> = {
    nodes: [],
    transform: [0, 0, 1],
    userSelectionActive: false,
    nodesSelectionActive: false,
    viewportInitialized: false,
  }
  const listeners = new Set<(state: Record<string, unknown>) => void>()
  return {
    instanceBeforeInit: { ...methods },
    instanceAfterInit: { ...methods },
    state,
    setState: (partial: Record<string, unknown>) => {
      Object.assign(state, partial)
      listeners.forEach(listener => listener(state))
    },
    subscribe: (listener: (state: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    storeApi: null as unknown,
    Probe: null as null | React.ComponentType,
  }
})
rf.storeApi = { getState: () => rf.state, setState: rf.setState, subscribe: rf.subscribe }

vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const { useSyncExternalStore, useRef, memo: reactMemo } = await import('react')
  const useFlowStore = <T,>(selector: (state: Record<string, unknown>) => T): T => {
    const cache = useRef<{ value: T } | null>(null)
    const read = (): T => {
      const next = selector(rf.state)
      if (cache.current && JSON.stringify(cache.current.value) === JSON.stringify(next)) {
        return cache.current.value
      }
      cache.current = { value: next }
      return next
    }
    return useSyncExternalStore(rf.subscribe, read, read)
  }
  type ViewNode = {
    id: string
    type: string
    data: unknown
    position: { x: number; y: number }
    selected?: boolean
    dragging?: boolean
    dragHandle?: string
    width?: number
    height?: number
  }
  // React Flow's NodeWrapper renders again when the view object of its node changes.
  const NodeWrapper = reactMemo(function NodeWrapper({
    node,
    NodeComponent,
  }: {
    node: ViewNode
    NodeComponent: React.ComponentType<Record<string, unknown>>
  }) {
    return (
      <NodeComponent
        id={node.id}
        data={node.data}
        type={node.type}
        selected={node.selected === true}
        dragging={node.dragging === true}
        dragHandle={node.dragHandle}
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
        width={node.width}
        height={node.height}
        isConnectable={false}
        zIndex={0}
      />
    )
  })
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () =>
      useFlowStore(state => state.viewportInitialized === true)
        ? rf.instanceAfterInit
        : rf.instanceBeforeInit,
    useStore: useFlowStore,
    useStoreApi: () => rf.storeApi,
    ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    applyNodeChanges: actual.applyNodeChanges,
    ReactFlow: ({
      nodes,
      nodeTypes,
      onNodesChange,
      children,
    }: {
      nodes: ViewNode[]
      nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>
      children?: React.ReactNode
      onNodesChange?: (changes: unknown[]) => void
    }) => {
      rf.state.nodes = nodes
      const Probe = rf.Probe
      return (
        <div>
          <button
            type="button"
            data-testid="select-web"
            onClick={() => onNodesChange?.([{ type: 'select', id: 'A-web', selected: true }])}
          />
          <button
            type="button"
            data-testid="drag-web"
            onClick={() =>
              onNodesChange?.([
                { type: 'position', id: 'A-web', position: { x: 1230, y: 20 }, dragging: true },
              ])
            }
          />
          {Probe ? <Probe /> : null}
          {nodes.map(node => {
            const NodeComponent = nodeTypes[node.type]
            return NodeComponent ? (
              <NodeWrapper key={node.id} node={node} NodeComponent={NodeComponent} />
            ) : null
          })}
          {children}
        </div>
      )
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    BackgroundVariant: { Dots: 'dots' },
    SelectionMode: { Partial: 'partial' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    PanOnScrollMode: { Free: 'free' },
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
  }
})

// Records the params value on every render of React Flow (whether or not it changed).
const seenParams: unknown[] = []
const readers: { selection: null | (() => unknown); ui: null | (() => Record<string, unknown>) } = {
  selection: null,
  ui: null,
}
function ParamsProbe(): null {
  seenParams.push(useWorkspaceCanvasNodeTypeParameters())
  readers.selection = useReadCanvasSelection()
  readers.ui = useReadCanvasUi() as never
  return null
}
rf.Probe = ParamsProbe

const A = 'workspace-a'

const withKind = (
  id: string,
  type: string,
  x: number,
  data: Partial<TerminalNodeData>,
): Node<TerminalNodeData> => {
  const base = pixelNode({ sessionId: '', title: id, ...data })
  return {
    ...base,
    id,
    type,
    position: { x, y: 0 },
    initialWidth: base.data.width,
    initialHeight: base.data.height,
  }
}

function nodesOf(prefix: string): Node<TerminalNodeData>[] {
  const term = agentNode(`${prefix}-term`, { title: `${prefix}-term` })
  const task = taskNode(`${prefix}-task`, '')
  return [
    withKind(`${prefix}-note`, 'noteNode', 0, { kind: 'note', note: { text: 'x' } }),
    withKind(`${prefix}-web`, 'websiteNode', 1200, {
      kind: 'website',
      website: {
        url: 'https://example.com',
        pinned: false,
        sessionMode: 'shared',
        profileId: null,
        browserMode: 'iframe',
      },
    } as Partial<TerminalNodeData>),
    withKind(`${prefix}-doc`, 'documentNode', 2400, {
      kind: 'document',
      document: { uri: 'file:///repo/readme.md' },
    } as Partial<TerminalNodeData>),
    withKind(`${prefix}-folder`, 'folderNode', 3600, {
      kind: 'folder',
      folder: { uri: 'file:///repo', rootUri: 'file:///repo', viewMode: 'icons' },
    } as Partial<TerminalNodeData>),
    withKind(`${prefix}-img`, 'imageNode', 4800, {
      kind: 'image',
      image: {
        assetId: 'asset',
        mimeType: 'image/png',
        fileName: null,
        naturalWidth: 1,
        naturalHeight: 1,
      },
    } as Partial<TerminalNodeData>),
    withKind(`${prefix}-plugin`, 'pluginNode', 6000, {
      kind: 'plugin',
      plugin: { pluginId: 'probe.plugin', viewId: 'main', state: {} },
    } as Partial<TerminalNodeData>),
    { ...term, position: { x: 7200, y: 0 } },
    { ...task, position: { x: 8400, y: 0 }, data: { ...task.data, title: `${prefix}-task` } },
    withKind(`${prefix}-role`, 'roleNode', 9600, {
      kind: 'role',
      role: {
        roleId: 'r',
        roleName: 'Role',
        roleDescription: '',
        promptTemplate: 'Do: {{input}}',
        inputHint: '',
        outputFormat: '',
        input: '',
        selectedProvider: 'codex',
        linkedAgentNodeId: null,
        runHistory: [],
        createdAt: null,
        updatedAt: null,
      },
    } as Partial<TerminalNodeData>),
  ]
}

const readAgentSettings = () => useAppStore.getState().agentSettings
const onShowMessage = () => undefined

function CanvasHarness() {
  const workspaceId = A
  const agentSettings = useAppStore(state => state.agentSettings)
  const nodes = useWorkspaceCanvasStoreNodes(workspaceId)
  return (
    <WorkspaceCanvas
      workspaceId={workspaceId}
      workspacePath={`/tmp/${workspaceId}`}
      worktreesRoot=""
      nodes={nodes}
      spaces={[]}
      activeSpaceId={null}
      onActiveSpaceChange={() => undefined}
      onShowMessage={onShowMessage}
      viewport={{ x: 0, y: 0, zoom: 1 }}
      isMinimapVisible={false}
      onViewportChange={() => undefined}
      onMinimapVisibilityChange={() => undefined}
      agentSettings={agentSettings}
      readAgentSettings={readAgentSettings}
      onAppendSpaceArchiveRecord={() => undefined}
      onChangePreserveWindowSizesOnArrange={() => undefined}
    />
  )
}

const MemoHarness = memo(CanvasHarness)

function stubOpencoveApi(): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        spawn: vi.fn(),
        kill: vi.fn(async () => undefined),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        onState: vi.fn(() => () => undefined),
        onMetadata: vi.fn(() => () => undefined),
      },
      workspace: { ensureDirectory: vi.fn(async () => undefined) },
      agent: { launch: vi.fn() },
      task: { suggestTitle: vi.fn() },
    },
  })
}

beforeEach(async () => {
  stubOpencoveApi()
  await applyUiLanguage('en')
  useAppStore.setState({
    agentSettings: { ...DEFAULT_AGENT_SETTINGS, focusNodeOnClick: true, focusNodeTargetZoom: 0.66 },
  })
  seedWorkspaceCanvasStore({ workspaceId: A, nodes: nodesOf('A') })
  rf.setState({
    viewportInitialized: true,
    nodesSelectionActive: false,
    userSelectionActive: false,
    coveDragSurfaceSelectionMode: false,
  })
  setCenterCalls.length = 0
})
afterEach(() => {
  cleanup()
})

async function mountWithWebSelected(): Promise<void> {
  render(
    <I18nProvider>
      <MemoHarness />
    </I18nProvider>,
  )
  await act(async () => {})
  await act(async () => {
    fireEvent.click(screen.getByTestId('select-web'))
  })
}
const nodeOf = (id: string) => readWorkspaceDocument(A)!.nodes.find(node => node.id === id)!
const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
  })

describe('a window body reaches the command it names', () => {
  it('the note title editor renames the title and keeps the text', async () => {
    await mountWithWebSelected()
    await act(async () => {
      ;(leafProps['A-note']!.onTitleChange as (title: string) => void)('Renamed')
    })
    expect(nodeOf('A-note').data.title).toBe('Renamed')
    expect(nodeOf('A-note').data.titlePinnedByUser).toBe(true)
    expect(nodeOf('A-note').data.note?.text).toBe('x')
  })

  it('the website mode switch sets the browser mode', async () => {
    await mountWithWebSelected()
    const before = nodeOf('A-web').data.website!.browserMode
    const next = before === 'native' ? 'iframe' : 'native'
    await act(async () => {
      ;(leafProps['A-web']!.onModeChange as (mode: string) => void)(next)
    })
    expect(nodeOf('A-web').data.website!.browserMode).toBe(next)
  })

  it('the collapsed shell toggles the window into the selection', async () => {
    await mountWithWebSelected()
    await act(async () => {
      ;(leafProps['collapse:A-note']!.onToggleSelection as () => void)()
    })
    expect((readers.selection!() as { nodeIds: string[] }).nodeIds).toEqual(['A-note', 'A-web'])
  })

  it('a document body that asks to clear the selection clears it', async () => {
    await mountWithWebSelected()
    await act(async () => {
      ;(leafProps['A-doc']!.onInteractionStart as (options: unknown) => void)({
        clearSelection: true,
        selectNode: false,
        normalizeViewport: false,
      })
    })
    await settle()
    expect((readers.selection!() as { nodeIds: string[] }).nodeIds).toEqual([])
  })

  it('the Delete key opens the delete confirmation for the selected windows', async () => {
    await mountWithWebSelected()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    expect(readers.ui!().nodeDeleteConfirmation).toMatchObject({ nodeIds: ['A-web'] })
  })
})
