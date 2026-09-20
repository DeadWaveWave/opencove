import { act, cleanup, renderHook } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  type NodeExpandBehavior,
} from '@contexts/settings/domain/agentSettings'
import { useCanvasCollapse } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCanvasCollapse'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'

function createNode(id: string, x = 0): Node<TerminalNodeData> {
  return {
    id,
    position: { x, y: 0 },
    data: {
      title: id,
      kind: 'terminal',
      sessionId: `${id}-session`,
      width: 640,
      height: 480,
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: 'ongoing output',
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function seedCollapsedTarget() {
  useCanvasCollapseStore.setState({
    workspaces: { project: { collapsedNodeIds: { target: true }, collapsedSpaceIds: {} } },
  })
}

function renderActions(behavior: NodeExpandBehavior = DEFAULT_AGENT_SETTINGS.nodeExpandBehavior) {
  const originalNodes = [createNode('target'), createNode('peer', 200)]
  const nodesRef = { current: originalNodes }
  const spacesRef = { current: [] as WorkspaceSpaceState[] }
  const setNodes = vi.fn(
    (updater: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
      nodesRef.current = updater(nodesRef.current)
    },
  )
  const onSpacesChange = vi.fn((spaces: WorkspaceSpaceState[]) => {
    spacesRef.current = spaces
  })
  const setCenter = vi.fn()
  const reactFlow = { setCenter } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
  const onRequestPersistFlush = vi.fn()
  seedCollapsedTarget()
  const hook = renderHook(
    ({ nodeExpandBehavior }: { nodeExpandBehavior: NodeExpandBehavior }) =>
      useCanvasCollapse({
        workspaceId: 'project',
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        nodesRef,
        spacesRef,
        setNodes,
        onSpacesChange,
        reactFlow,
        focusNodeTargetZoom: 0.85,
        nodeExpandBehavior,
        onRequestPersistFlush,
      }),
    { initialProps: { nodeExpandBehavior: behavior } },
  )
  return {
    ...hook,
    originalNodes,
    nodesRef,
    setNodes,
    onSpacesChange,
    setCenter,
    onRequestPersistFlush,
  }
}

afterEach(() => {
  cleanup()
  useCanvasCollapseStore.setState({ workspaces: {} })
  localStorage.removeItem('opencove:canvas-collapse:v1')
})

describe('collapsed window expansion actions', () => {
  it('uses the default resize layout in place, pushes its peer and retains runtime data', () => {
    const actions = renderActions()
    act(() => actions.result.current.toggleNode('target'))
    const [target, peer] = actions.nodesRef.current
    expect(target.position).toEqual(actions.originalNodes[0].position)
    expect(peer.position).not.toEqual(actions.originalNodes[1].position)
    expect(
      peer.position.x >= target.position.x + target.data.width ||
        peer.position.y >= target.position.y + target.data.height,
    ).toBe(true)
    expect(target.data).toBe(actions.originalNodes[0].data)
    expect(peer.data).toBe(actions.originalNodes[1].data)
    expect(actions.originalNodes[1].position).toEqual({ x: 200, y: 0 })
    expect(actions.result.current.collapsedNodeIds.target).toBeUndefined()
    expect(actions.setNodes).toHaveBeenCalledWith(expect.any(Function), { syncLayout: false })
    expect(actions.onRequestPersistFlush).toHaveBeenCalledOnce()
    expect(actions.setCenter).not.toHaveBeenCalled()
  })

  it('reveals into nearby free space and focuses the relocated target rather than its old position', () => {
    const actions = renderActions('find-space')
    act(() => actions.result.current.revealNode('target'))
    const [target, peer] = actions.nodesRef.current
    expect(target.position).not.toEqual(actions.originalNodes[0].position)
    expect(peer).toBe(actions.originalNodes[1])
    expect(target.data).toBe(actions.originalNodes[0].data)
    expect(actions.setCenter).toHaveBeenCalledWith(
      target.position.x + target.data.width / 2,
      target.position.y + target.data.height / 2,
      expect.objectContaining({ zoom: 0.85 }),
    )
    expect(actions.result.current.collapsedNodeIds.target).toBeUndefined()
  })

  it('ignores actions for a node that was deleted after the collapsed view was saved', () => {
    const actions = renderActions()
    actions.nodesRef.current = actions.nodesRef.current.filter(node => node.id !== 'target')
    const before = useCanvasCollapseStore.getState().workspaces.project
    act(() => {
      actions.result.current.toggleNode('target')
      actions.result.current.revealNode('target')
      expect(actions.result.current.expandNode('target')).toBeUndefined()
    })
    expect(actions.setNodes).not.toHaveBeenCalled()
    expect(actions.onSpacesChange).not.toHaveBeenCalled()
    expect(actions.onRequestPersistFlush).not.toHaveBeenCalled()
    expect(actions.setCenter).not.toHaveBeenCalled()
    expect(useCanvasCollapseStore.getState().workspaces.project).toBe(before)
  })

  it('does not re-layout or flush an already expanded window when revealed again', () => {
    const actions = renderActions('find-space')
    act(() => actions.result.current.revealNode('target'))
    const expandedNodes = actions.nodesRef.current
    actions.setNodes.mockClear()
    actions.onSpacesChange.mockClear()
    actions.onRequestPersistFlush.mockClear()
    act(() => actions.result.current.revealNode('target'))
    expect(actions.nodesRef.current).toBe(expandedNodes)
    expect(actions.setNodes).not.toHaveBeenCalled()
    expect(actions.onSpacesChange).not.toHaveBeenCalled()
    expect(actions.onRequestPersistFlush).not.toHaveBeenCalled()
    expect(actions.setCenter).toHaveBeenCalledTimes(2)
  })

  it('honors a settings change before the next toggle and focuses the relocated window', () => {
    const actions = renderActions()
    actions.rerender({ nodeExpandBehavior: 'find-space' })
    act(() => actions.result.current.toggleNode('target'))
    const [target, peer] = actions.nodesRef.current
    expect(target.position).not.toEqual(actions.originalNodes[0].position)
    expect(peer).toBe(actions.originalNodes[1])
    expect(actions.setCenter).toHaveBeenCalledWith(
      target.position.x + target.data.width / 2,
      target.position.y + target.data.height / 2,
      expect.objectContaining({ zoom: 0.85 }),
    )
  })
})
