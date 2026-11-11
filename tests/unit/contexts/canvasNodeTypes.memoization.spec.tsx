import React, { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi, useViewport, type Node } from '@xyflow/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasActionRefs } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useActionRefs'
import { useWorkspaceCanvasComposedNodeTypes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeTypes'
import { useWorkspaceCanvasNodeTypes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes'
import { WorkspaceCanvasNodeTypesProvider } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import { TerminalDisplayAlignmentProvider } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/TerminalDisplayAlignmentContext'
import {
  readWindowCommitCounts,
  readWindowCommitRecords,
  readWindowPresentationCommitCounts,
  resetWindowCommitCounts,
} from '@contexts/workspace/presentation/renderer/components/shared/windowCommitProbe'

// Keep every production context consumer, collapse shell, WebsiteNode, WindowHeader and
// viewport subscription. Only unrelated window bodies (PTY/editor/plugin/etc.) are stubbed.
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.terminal',
  () => ({ WorkspaceCanvasTerminalNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.note',
  () => ({ WorkspaceCanvasNoteNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.document',
  () => ({ WorkspaceCanvasDocumentNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.folder',
  () => ({ WorkspaceCanvasFolderNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.image',
  () => ({ WorkspaceCanvasImageNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.role',
  () => ({ WorkspaceCanvasRoleNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.task',
  () => ({ WorkspaceCanvasTaskNodeType: () => null }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.plugin',
  () => ({ WorkspaceCanvasPluginNodeType: () => null }),
)

const base: TerminalNodeData = {
  kind: 'website',
  sessionId: '',
  title: 'Example',
  width: 640,
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
  website: {
    url: 'about:blank',
    pinned: false,
    sessionMode: 'shared',
    profileId: null,
    browserMode: 'iframe',
  },
}
const nodes: Node<TerminalNodeData>[] = [
  'terminal',
  'note',
  'document',
  'folder',
  'website',
  'plugin',
  'image',
  'role',
  'task',
].map(kind => ({
  id: kind,
  type: kind + 'Node',
  position: { x: 0, y: 0 },
  data: { ...base, kind: kind as TerminalNodeData['kind'] },
}))
const commands = {
  setNodes: vi.fn(),
  setNodeLabelColorOverride: vi.fn(),
  convertNoteToTask: () => false,
  onShowMessage: vi.fn(),
}
const alignment = {
  terminalFontSize: 13,
  terminalFontFamily: null,
  terminalTransparentBackground: false,
  terminalDisplayCalibration: null,
}
const originalApi = window.opencoveApi
let store: ReturnType<typeof useStoreApi>
let parameters: ReturnType<typeof useWorkspaceCanvasNodeTypes>['nodeTypesParameters']
let nodeTypes: ReturnType<typeof useWorkspaceCanvasNodeTypes>['nodeTypes']
let parentRenders = 0

function Canvas() {
  parentRenders++
  store = useStoreApi()
  const viewport = useViewport()
  const [tick, setTick] = useState(0)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([])
  const selectedNodeIdsRef = useRef(selectedNodeIds)
  const selectedSpaceIdsRef = useRef(selectedSpaceIds)
  const spacesRef = useRef<WorkspaceSpaceState[]>([])
  const actionRefs = useWorkspaceCanvasActionRefs()
  const composed = useWorkspaceCanvasComposedNodeTypes({
    nodeStore: { ...commands },
    canvasState: {
      setSelectedNodeIds,
      setSelectedSpaceIds,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      spacesRef,
    },
    actionRefs,
    workspacePath: '/tmp/canvas-memoization',
    agentSettings: { ...DEFAULT_AGENT_SETTINGS },
    convertNoteToTask: commands.convertNoteToTask,
    onShowMessage: commands.onShowMessage,
  })
  parameters = composed.nodeTypesParameters
  nodeTypes = composed.nodeTypes
  return (
    <>
      <button onClick={() => setTick(tick + 1)}>Parent update</button>
      <output data-testid="viewport">{JSON.stringify(viewport)}</output>
      <TerminalDisplayAlignmentProvider value={alignment}>
        <WorkspaceCanvasNodeTypesProvider value={parameters}>
          {nodes.map(node => {
            const View = composed.nodeTypes[node.type!]
            return (
              <div key={node.id} className="react-flow__node" data-id={node.id}>
                <View id={node.id} data={node.data} />
              </div>
            )
          })}
        </WorkspaceCanvasNodeTypesProvider>
      </TerminalDisplayAlignmentProvider>
    </>
  )
}

afterEach(() => {
  cleanup()
  resetWindowCommitCounts()
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
})

it.each(['unchanged parent', 'viewport pan', 'viewport zoom'])(
  'keeps all node consumers and the real website header uncommitted on %s updates',
  update => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { meta: { isTest: true } },
    })
    parentRenders = 0
    const { container } = render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )
    const initialParameters = parameters
    const initialTypes = nodeTypes
    const iframe = container.querySelector('iframe.website-node__iframe')
    expect(iframe).not.toBeNull()
    // A live probe and all nine consumers must be mounted before measuring zero commits.
    expect(Object.keys(nodeTypes).sort()).toEqual(nodes.map(node => node.type).sort())
    expect(
      readWindowCommitRecords()
        .filter(record => record.component === 'node')
        .map(record => record.nodeId)
        .sort(),
    ).toEqual(nodes.map(node => node.id).sort())
    expect(readWindowCommitCounts()).toEqual({ media: 1 })
    expect(Object.keys(readWindowPresentationCommitCounts())).toHaveLength(nodes.length)
    const before = parentRenders
    resetWindowCommitCounts()
    if (update === 'unchanged parent') {
      fireEvent.click(screen.getByRole('button', { name: 'Parent update' }))
    } else {
      const transform: [number, number, number] =
        update === 'viewport pan' ? [80, 40, 1] : [0, 0, 0.4]
      act(() => store.setState({ transform }))
      expect(screen.getByTestId('viewport').textContent).toBe(
        JSON.stringify({ x: transform[0], y: transform[1], zoom: transform[2] }),
      )
    }
    expect(parentRenders).toBeGreaterThan(before)
    expect(readWindowCommitRecords()).toEqual([])
    expect(readWindowCommitCounts()).toEqual({})
    expect(readWindowPresentationCommitCounts()).toEqual({})
    expect(parameters).toBe(initialParameters)
    expect(nodeTypes).toBe(initialTypes)
    expect(container.querySelector('iframe.website-node__iframe')).toBe(iframe)
  },
)

it('keeps every individual command, preference and ref current without changing component types', () => {
  render(React.createElement(ReactFlowProvider, null, React.createElement(Canvas)))
  const initial = parameters
  const { result, rerender } = renderHook(props => useWorkspaceCanvasNodeTypes({ ...props }), {
    initialProps: initial,
  })
  const initialTypes = result.current.nodeTypes
  for (const key of Object.keys(initial) as (keyof typeof initial)[]) {
    const value = initial[key]
    const replacement =
      typeof value === 'function'
        ? vi.fn()
        : Array.isArray(value)
          ? [...value].reverse()
          : typeof value === 'object' && value
            ? { ...value }
            : key === 'defaultProvider'
              ? 'claude-code'
              : key === 'browserDefaultMode'
                ? 'iframe'
                : key === 'browserSearchEngine'
                  ? 'bing'
                  : '/tmp/another-workspace'
    expect(replacement, key).not.toBe(value)
    rerender({ ...initial, [key]: replacement })
    expect(result.current.nodeTypesParameters[key], key).toBe(replacement)
    expect(result.current.nodeTypes, key).toBe(initialTypes)
    rerender(initial)
  }
})
