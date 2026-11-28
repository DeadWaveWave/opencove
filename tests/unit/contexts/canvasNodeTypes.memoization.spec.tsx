import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ReactFlowProvider, useReactFlow, useStoreApi, useViewport, type Node } from '@xyflow/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CanvasStoreTestProvider } from '../../support/canvasStoreTestHarness'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { useComposedCanvasNodeCommands } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeCommands'
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
// viewport subscription. Only unrelated window bodies (PTY/editor/plugin/etc.) are stubbed. The
// terminal's body, which reads the commands (S7, PR 5), is the production one: only the xterm
// window under it is stubbed, and counts its renders, so that a body that renders again shows.
const terminalWindow = vi.hoisted(() => ({ renders: 0 }))
vi.mock('@contexts/workspace/presentation/renderer/components/TerminalNode', () => ({
  TerminalNode: () => {
    terminalWindow.renders++
    return null
  },
}))
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
// The functions that implement the commands, stable as they are in the app: the commands are made
// of them and renew only when one of them does.
const implementations = {
  selectNode: vi.fn(),
  clearNodeSelection: vi.fn(),
  requestNodeClose: vi.fn(async () => undefined),
  requestNodeDelete: vi.fn(),
  resizeNode: vi.fn(),
  setNodeLabelColorOverride: vi.fn(),
  updateScrollback: vi.fn(),
  recordCommandRun: vi.fn(),
  clearAgentOverlay: vi.fn(),
  renameTerminalTitle: vi.fn(),
  copyLastAgentMessage: vi.fn(async () => undefined),
  reloadAgentSession: vi.fn(async () => undefined),
  listAgentSessions: vi.fn(async () => []),
  switchAgentSession: vi.fn(async () => undefined),
  updateNoteText: vi.fn(),
  renameNoteTitle: vi.fn(),
  convertNoteToTask: () => false,
  updateWebsiteUrl: vi.fn(),
  setWebsitePinned: vi.fn(),
  setWebsiteSession: vi.fn(),
  setWebsiteMode: vi.fn(),
  setWebsiteFullscreen: vi.fn(),
  updateRoleInput: vi.fn(),
  updateRoleProvider: vi.fn(),
  runRole: vi.fn(async () => undefined),
  runTaskAgent: vi.fn(async () => undefined),
  resumeTaskAgentSession: vi.fn(async () => undefined),
  removeTaskAgentSessionRecord: vi.fn(),
  openTaskEditor: vi.fn(),
  updateTaskTitle: vi.fn(),
  updateTaskRequirement: vi.fn(),
  updateTaskStatus: vi.fn(),
}
const onShowMessage = vi.fn()
const readAgentSettings = () => DEFAULT_AGENT_SETTINGS
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
  const reactFlow = useReactFlow<Node<TerminalNodeData>>()
  const commands = useComposedCanvasNodeCommands({
    reactFlow,
    readAgentSettings,
    ...implementations,
  })
  const composed = useWorkspaceCanvasComposedNodeTypes({
    workspacePath: '/tmp/canvas-memoization',
    agentSettings: { ...DEFAULT_AGENT_SETTINGS },
    commands,
    onShowMessage,
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
  terminalWindow.renders = 0
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
      <CanvasStoreTestProvider>
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </CanvasStoreTestProvider>,
    )
    const initialParameters = parameters
    const initialCommands = parameters.commands
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
    const terminalRendersBefore = terminalWindow.renders
    expect(terminalRendersBefore).toBeGreaterThan(0)
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
    // The production terminal body is a consumer of the commands too: it renders for none of them.
    expect(terminalWindow.renders).toBe(terminalRendersBefore)
    expect(parameters).toBe(initialParameters)
    // The commands are composed again on every parent render and keep their identity.
    expect(parameters.commands).toBe(initialCommands)
    expect(nodeTypes).toBe(initialTypes)
    expect(container.querySelector('iframe.website-node__iframe')).toBe(iframe)
  },
)

it('keeps every individual command, preference and ref current without changing component types', () => {
  render(
    <CanvasStoreTestProvider>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </CanvasStoreTestProvider>,
  )
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
