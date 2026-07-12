import React, { useRef } from 'react'
import { act, render } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasViewportNavigation } from './useViewportNavigation'

const NODE: Node<TerminalNodeData> = {
  id: 'agent-1',
  type: 'terminalNode',
  position: { x: 2_400, y: 1_600 },
  data: {
    sessionId: 'session-1',
    title: 'Agent 1',
    width: 480,
    height: 320,
    kind: 'agent',
    status: 'standby',
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
    website: null,
  },
}

const PERSISTED_VIEWPORT: Viewport = { x: -120, y: -80, zoom: 0.6 }

function ViewportNavigationHarness({
  reactFlow,
  focusNodeId,
  focusSpaceId = null,
  focusSequence = 1,
  nodes = [NODE],
  focusSpaceInViewport = () => false,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  focusNodeId?: string | null
  focusSpaceId?: string | null
  focusSequence?: number
  nodes?: Node<TerminalNodeData>[]
  focusSpaceInViewport?: (spaceId: string) => boolean
}): React.JSX.Element {
  const restoredViewportWorkspaceIdRef = useRef<string | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  useWorkspaceCanvasViewportNavigation({
    workspaceId: 'workspace-1',
    persistedViewport: PERSISTED_VIEWPORT,
    restoredViewportWorkspaceIdRef,
    reactFlow,
    focusNodeId,
    focusSpaceId,
    focusSequence,
    nodes,
    nodesRef,
    spaces:
      focusSpaceId === null
        ? []
        : [
            {
              id: focusSpaceId,
              name: 'Focused space',
              directoryPath: '/tmp/focused-space',
              targetMountId: null,
              labelColor: null,
              nodeIds: [NODE.id],
              rect: { x: 2_200, y: 1_400, width: 900, height: 700 },
            },
          ],
    focusSpaceInViewport,
    focusNodeTargetZoom: 1,
  })

  return <div />
}

describe('useWorkspaceCanvasViewportNavigation', () => {
  let nextFrameId = 1
  let frames: Map<number, FrameRequestCallback>

  beforeEach(() => {
    frames = new Map()
    nextFrameId = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const frameId = nextFrameId++
      frames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frameId => {
      frames.delete(frameId)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function flushAnimationFrames(): void {
    const pending = [...frames.entries()]
    frames.clear()
    pending.forEach(([, callback]) => callback(0))
  }

  function createReactFlow(): ReactFlowInstance<Node<TerminalNodeData>, Edge> {
    return {
      getViewport: vi.fn(() => PERSISTED_VIEWPORT),
      setViewport: vi.fn(async () => true),
      setCenter: vi.fn(async () => true),
      zoomTo: vi.fn(async () => true),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
  }

  it('does not let the persisted viewport overwrite an explicit agent focus request', () => {
    const reactFlow = createReactFlow()

    render(<ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} />)

    act(flushAnimationFrames)

    expect(reactFlow.setCenter).toHaveBeenCalledWith(2_640, 1_760, {
      duration: 220,
      zoom: 1,
    })
    expect(reactFlow.setViewport).not.toHaveBeenCalled()
  })

  it('restores the persisted viewport when there is no explicit focus request', () => {
    const reactFlow = createReactFlow()

    render(<ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={null} />)

    act(flushAnimationFrames)

    expect(reactFlow.setViewport).toHaveBeenCalledWith(PERSISTED_VIEWPORT, { duration: 0 })
    expect(reactFlow.setCenter).not.toHaveBeenCalled()
  })

  it('falls back to the persisted viewport when the requested agent no longer exists', () => {
    const reactFlow = createReactFlow()

    render(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId="deleted-agent"
        nodes={[NODE]}
      />,
    )

    act(flushAnimationFrames)

    expect(reactFlow.setViewport).toHaveBeenCalledWith(PERSISTED_VIEWPORT, { duration: 0 })
    expect(reactFlow.setCenter).not.toHaveBeenCalled()
  })

  it('does not let the persisted viewport overwrite an explicit space focus request', () => {
    const reactFlow = createReactFlow()
    const focusSpaceInViewport = vi.fn(() => true)

    render(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId={null}
        focusSpaceId="space-1"
        focusSpaceInViewport={focusSpaceInViewport}
      />,
    )

    act(flushAnimationFrames)

    expect(focusSpaceInViewport).toHaveBeenCalledWith('space-1')
    expect(reactFlow.setViewport).not.toHaveBeenCalled()
  })

  it('applies a newer focus sequence for the same agent', () => {
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusSequence={1} />,
    )
    act(flushAnimationFrames)

    rendered.rerender(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusSequence={2} />,
    )
    act(flushAnimationFrames)

    expect(reactFlow.setCenter).toHaveBeenCalledTimes(2)
  })

  it('cancels a superseded initial frame so only the latest focus request lands', () => {
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusSequence={1} />,
    )

    rendered.rerender(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusSequence={2} />,
    )
    act(flushAnimationFrames)

    expect(reactFlow.setCenter).toHaveBeenCalledTimes(1)
    expect(reactFlow.setViewport).not.toHaveBeenCalled()
  })
})
