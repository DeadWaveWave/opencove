import React, { memo, useState } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { I18nProvider, applyUiLanguage } from '../../../src/app/renderer/i18n'
import { WorkspaceCanvas } from '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas'
import { useWorkspaceCanvasNodeTypeParameters } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import type {
  TerminalNodeData,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  seedWorkspaceCanvasStore,
  useWorkspaceCanvasStoreNodes,
} from '../../support/workspaceCanvasStoreHarness'
import { agentNode, taskNode } from '../../support/agentRuntimeHarness'
import { pixelNode } from './workspacePixelLayer.fixtures'

// S7 of #647 (review of PR 4): what a node component consumes, in a mounted canvas. The React Flow
// mock renders the real node types the way React Flow's NodeWrapper does (memoised on the view
// object, with its props). "outer" counts renders of the memoised wrapper in nodeTypes.tsx (its
// commit probe is called in the render body); "leaf" counts renders of the window body (the leaf
// components are stubs). A body that reads only the commands must not render for a preference,
// and a settings object that arrives as a deserialized copy, as a Worker sync delivers it, must
// renew nothing while its preferences are equal.

const counts = vi.hoisted(() => ({
  outer: {} as Record<string, number>,
  leaf: {} as Record<string, number>,
}))

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
      [name]: (props: { nodeId?: string; id?: string; title?: string }) => {
        const key = String(props.nodeId ?? props.id ?? props.title ?? name)
        counts.leaf[key] = (counts.leaf[key] ?? 0) + 1
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
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/windowSignals/WorkspaceWindowSignals',
  () => ({ WorkspaceWindowSignals: () => null }),
)

const rf = vi.hoisted(() => {
  const methods = {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => undefined,
    setCenter: () => undefined,
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
function ParamsProbe(): null {
  seenParams.push(useWorkspaceCanvasNodeTypeParameters())
  return null
}
rf.Probe = ParamsProbe

const A = 'workspace-a'
const B = 'workspace-b'

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
let controls: {
  showWorkspace: (id: string) => void
  setPath: (path: string) => void
  setEnv: (env: Record<string, string>) => void
  setCalibration: (value: unknown) => void
  setOnShowMessage: (fn: () => void) => void
}
const firstOnShowMessage = () => undefined

function CanvasHarness() {
  const [workspaceId, setWorkspaceId] = useState(A)
  const [path, setPath] = useState<string | null>(null)
  const [env, setEnv] = useState<Record<string, string> | undefined>(undefined)
  const [calibration, setCalibration] = useState<unknown>(null)
  const [onShowMessage, setOnShowMessage] = useState<() => void>(() => firstOnShowMessage)
  controls = {
    showWorkspace: id => {
      useAppStore.setState({ activeWorkspaceId: id })
      setWorkspaceId(id)
    },
    setPath,
    setEnv,
    setCalibration,
    setOnShowMessage: fn => setOnShowMessage(() => fn),
  }
  const agentSettings = useAppStore(state => state.agentSettings)
  const nodes = useWorkspaceCanvasStoreNodes(workspaceId)
  return (
    <WorkspaceCanvas
      workspaceId={workspaceId}
      workspacePath={path ?? `/tmp/${workspaceId}`}
      environmentVariables={env}
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
      terminalDisplayCalibration={calibration as never}
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

const settings = (patch: Record<string, unknown>) => () =>
  useAppStore.setState(state => ({ agentSettings: { ...state.agentSettings, ...patch } }))

beforeEach(async () => {
  stubOpencoveApi()
  await applyUiLanguage('en')
  useAppStore.setState({ agentSettings: { ...DEFAULT_AGENT_SETTINGS } })
  seedWorkspaceCanvasStore({ workspaceId: A, nodes: nodesOf('A') })
  useAppStore.setState(state => ({
    workspaces: [
      ...state.workspaces,
      {
        ...state.workspaces[0],
        id: B,
        name: B,
        path: `/tmp/${B}`,
        nodes: nodesOf('B'),
        spaces: [],
      } as WorkspaceState,
    ],
  }))
  rf.setState({
    viewportInitialized: false,
    nodesSelectionActive: false,
    userSelectionActive: false,
  })
})
afterEach(() => {
  cleanup()
})

async function mountCanvas(): Promise<void> {
  render(
    <I18nProvider>
      <MemoHarness />
    </I18nProvider>,
  )
  await act(async () => {})
  await act(async () => {
    await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined)))
  })
  counts.outer = {}
  counts.leaf = {}
}

describe('what node components consume keeps its identity (Decision 14)', () => {
  it('keeps the params value, and renders no window, when the settings arrive as a new object with equal preferences (a Worker sync of a zoom change)', async () => {
    await mountCanvas()
    const before = seenParams[seenParams.length - 1]

    await act(async () => {
      useAppStore.setState(state => ({
        agentSettings: JSON.parse(
          JSON.stringify({ ...state.agentSettings, focusNodeTargetZoom: 0.71 }),
        ),
      }))
    })

    expect(seenParams[seenParams.length - 1]).toBe(before)
    expect(counts.outer).toEqual({})
    expect(counts.leaf).toEqual({})
  })

  it.each([
    [
      'browserDefaultMode',
      () =>
        useAppStore.setState(state => ({
          agentSettings: {
            ...state.agentSettings,
            browserDefaultMode:
              state.agentSettings.browserDefaultMode === 'native' ? 'iframe' : 'native',
          },
        })),
    ],
    ['the workspace path', () => controls.setPath('/tmp/edited')],
  ])(
    'does not render the terminal body, which reads none of the preferences, when %s changes',
    async (_name, change) => {
      await mountCanvas()

      await act(async () => {
        change()
      })

      // The memoised terminal body reads no preference: it bails out, as it did before S7.
      expect(counts.leaf['A-term'] ?? 0).toBe(0)
      // The window whose body reads the preference does render.
      expect(counts.leaf['A-web'] ?? 0).toBeGreaterThan(0)
    },
  )

  // Commands have their own context, so a body that reads only commands is not a consumer of the
  // params: nothing but the bodies that read a preference, the host callback, the path or the
  // provider order renders (terminal, document, folder, image and plugin do not).
  it.each([
    [
      'browserDefaultMode',
      settings({
        browserDefaultMode:
          DEFAULT_AGENT_SETTINGS.browserDefaultMode === 'native' ? 'iframe' : 'native',
      }),
    ],
    // The folder body also reads the filesystem actions, which are made for the workspace path.
    ['the workspace path', () => controls.setPath('/tmp/edited'), ['A-folder']],
    [
      'agentProviderOrder',
      settings({ agentProviderOrder: [...DEFAULT_AGENT_SETTINGS.agentProviderOrder].reverse() }),
    ],
  ])(
    'renders no body that reads no preference when %s changes',
    async (_name, change, also = []) => {
      await mountCanvas()

      await act(async () => {
        change()
      })

      const readers = ['A-note', 'A-web', 'A-task', 'A-role', ...also]
      expect(Object.keys(counts.leaf).length).toBeGreaterThan(0)
      expect(Object.keys(counts.leaf).filter(key => !readers.includes(key))).toEqual([])
    },
  )
})
