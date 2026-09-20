import React, { useRef } from 'react'
import { act, render } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../types'
import { focusNodeInViewport } from '../helpers'
import { useWorkspaceCanvasViewportNavigation } from './useViewportNavigation'
import { requestViewportNodeInputFocus } from '../requestViewportNodeInputFocus'

vi.mock('../requestViewportNodeInputFocus', () => ({
  requestViewportNodeInputFocus: vi.fn(() => vi.fn()),
}))

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
  workspaceId = 'workspace-1',
  focusNodeId,
  focusNodeInput,
  focusSpaceId = null,
  focusSequence = 1,
  nodes = [NODE],
  focusSpaceInViewport = () => false,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  workspaceId?: string
  focusNodeId?: string | null
  focusNodeInput?: boolean
  focusSpaceId?: string | null
  focusSequence?: number
  nodes?: Node<TerminalNodeData>[]
  focusSpaceInViewport?: (spaceId: string) => boolean
}): React.JSX.Element {
  const restoredViewportWorkspaceIdRef = useRef<string | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  useWorkspaceCanvasViewportNavigation({
    workspaceId,
    persistedViewport: PERSISTED_VIEWPORT,
    restoredViewportWorkspaceIdRef,
    reactFlow,
    focusNodeId,
    focusNodeInput,
    focusSpaceId,
    focusSequence,
    nodes,
    nodesRef,
    expandNode: id => nodesRef.current.find(node => node.id === id),
    focusSpaceInViewport,
    focusNodeTargetZoom: 1,
  })

  return <div />
}

describe('useWorkspaceCanvasViewportNavigation', () => {
  let nextFrameId = 1
  let frames: Map<number, FrameRequestCallback>

  beforeEach(() => {
    vi.mocked(requestViewportNodeInputFocus).mockClear()
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
      viewportInitialized: true,
      getViewport: vi.fn(() => PERSISTED_VIEWPORT),
      setViewport: vi.fn(async () => true),
      setCenter: vi.fn(async () => true),
      zoomTo: vi.fn(async () => true),
    } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
  }

  it('finishes initial restoration before a newly created node takes the viewport', () => {
    const reactFlow = createReactFlow()
    render(<ViewportNavigationHarness reactFlow={reactFlow} />)

    focusNodeInViewport(reactFlow, NODE)
    act(flushAnimationFrames)

    const restoreOrder = vi.mocked(reactFlow.setViewport).mock.invocationCallOrder.at(-1)!
    const focusOrder = vi.mocked(reactFlow.setCenter).mock.invocationCallOrder.at(-1)!
    expect(restoreOrder).toBeLessThan(focusOrder)
  })

  it('does not let the persisted viewport overwrite an explicit agent focus request', () => {
    const reactFlow = createReactFlow()

    render(<ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusNodeInput />)

    act(flushAnimationFrames)

    expect(reactFlow.setCenter).toHaveBeenCalledWith(2_640, 1_760, {
      duration: 220,
      interpolate: 'smooth',
      zoom: 1,
    })
    expect(reactFlow.setViewport).not.toHaveBeenCalled()
    expect(requestViewportNodeInputFocus).toHaveBeenCalledWith(NODE.id)
  })

  it.each([undefined, false])('only locates a node when input focus is %s', focusNodeInput => {
    const reactFlow = createReactFlow()
    render(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId={NODE.id}
        focusNodeInput={focusNodeInput}
      />,
    )

    act(flushAnimationFrames)

    expect(reactFlow.setCenter).toHaveBeenCalledWith(2_640, 1_760, {
      duration: 220,
      interpolate: 'smooth',
      zoom: 1,
    })
    expect(requestViewportNodeInputFocus).not.toHaveBeenCalled()
  })

  it('retries a delayed node with the original locate-only input intent', () => {
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId={NODE.id}
        focusNodeInput={false}
        nodes={[]}
      />,
    )
    act(flushAnimationFrames)
    expect(reactFlow.setViewport).toHaveBeenCalledWith(PERSISTED_VIEWPORT, { duration: 0 })

    rendered.rerender(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId={NODE.id}
        focusNodeInput={false}
        nodes={[NODE]}
      />,
    )

    expect(reactFlow.setCenter).toHaveBeenCalledTimes(1)
    expect(requestViewportNodeInputFocus).not.toHaveBeenCalled()
  })

  it.each([undefined, false])(
    'cancels pending input focus when newer input intent is %s',
    focusNodeInput => {
      const cancelFocus = vi.fn()
      vi.mocked(requestViewportNodeInputFocus).mockReturnValueOnce(cancelFocus)
      const reactFlow = createReactFlow()
      const rendered = render(
        <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusNodeInput />,
      )
      act(flushAnimationFrames)

      rendered.rerender(
        <ViewportNavigationHarness
          reactFlow={reactFlow}
          focusNodeId={NODE.id}
          focusNodeInput={focusNodeInput}
          focusSequence={2}
        />,
      )

      expect(cancelFocus).toHaveBeenCalled()
      expect(requestViewportNodeInputFocus).toHaveBeenCalledTimes(1)
      expect(reactFlow.setCenter).toHaveBeenCalledTimes(2)
    },
  )

  it('cancels pending input focus when the current request no longer requests it', () => {
    const cancelFocus = vi.fn()
    vi.mocked(requestViewportNodeInputFocus).mockReturnValueOnce(cancelFocus)
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusNodeInput />,
    )
    act(flushAnimationFrames)

    rendered.rerender(<ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} />)

    expect(cancelFocus).toHaveBeenCalled()
    expect(requestViewportNodeInputFocus).toHaveBeenCalledTimes(1)
    expect(reactFlow.setCenter).toHaveBeenCalledTimes(1)
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

  it('accepts the same agent again after returning to the project canvas cleared the request', () => {
    const cancelFocus = vi.fn()
    vi.mocked(requestViewportNodeInputFocus).mockReturnValueOnce(cancelFocus)
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId={NODE.id}
        focusNodeInput
        focusSequence={1}
      />,
    )
    act(flushAnimationFrames)

    rendered.rerender(<ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={null} />)
    expect(cancelFocus).toHaveBeenCalled()
    rendered.rerender(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        focusNodeId={NODE.id}
        focusNodeInput
        focusSequence={1}
      />,
    )

    expect(reactFlow.setCenter).toHaveBeenCalledTimes(2)
    expect(requestViewportNodeInputFocus).toHaveBeenCalledTimes(2)
  })

  it('stops an active transition at its live position when the canvas unmounts', () => {
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} />,
    )
    act(flushAnimationFrames)
    const interruptedViewport = { x: -500, y: -300, zoom: 0.8 }
    vi.mocked(reactFlow.getViewport).mockReturnValue(interruptedViewport)
    rendered.unmount()
    expect(reactFlow.setViewport).toHaveBeenLastCalledWith(interruptedViewport, { duration: 0 })
  })

  it('stops the previous workspace before restoring the next one', () => {
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} />,
    )
    act(flushAnimationFrames)
    const liveViewport = { x: -900, y: -200, zoom: 0.9 }
    vi.mocked(reactFlow.getViewport).mockReturnValue(liveViewport)
    rendered.rerender(<ViewportNavigationHarness reactFlow={reactFlow} workspaceId="workspace-2" />)
    expect(reactFlow.setViewport).toHaveBeenNthCalledWith(1, liveViewport, { duration: 0 })
    act(flushAnimationFrames)
    expect(reactFlow.setViewport).toHaveBeenLastCalledWith(PERSISTED_VIEWPORT, { duration: 0 })
  })

  it('cancels the old workspace input focus before requesting focus in the next workspace', () => {
    const cancelOldFocus = vi.fn()
    const cancelNewFocus = vi.fn()
    vi.mocked(requestViewportNodeInputFocus)
      .mockReturnValueOnce(cancelOldFocus)
      .mockReturnValueOnce(cancelNewFocus)
    const reactFlow = createReactFlow()
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusNodeInput />,
    )

    rendered.rerender(
      <ViewportNavigationHarness
        reactFlow={reactFlow}
        workspaceId="workspace-2"
        focusNodeId={NODE.id}
        focusNodeInput
      />,
    )

    expect(cancelOldFocus).toHaveBeenCalled()
    expect(requestViewportNodeInputFocus).toHaveBeenCalledTimes(2)
    expect(cancelOldFocus.mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(requestViewportNodeInputFocus).mock.invocationCallOrder[1],
    )
    expect(cancelNewFocus).not.toHaveBeenCalled()
    rendered.unmount()
    expect(cancelNewFocus).toHaveBeenCalled()
  })

  it('does not start a pending navigation after unmount', () => {
    const reactFlow = { ...createReactFlow(), viewportInitialized: false }
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} />,
    )
    rendered.unmount()
    act(flushAnimationFrames)
    expect(reactFlow.setCenter).not.toHaveBeenCalled()
  })

  it('keeps only the latest focus request while waiting for viewport initialization', () => {
    const reactFlow = { ...createReactFlow(), viewportInitialized: false }
    const rendered = render(
      <ViewportNavigationHarness reactFlow={reactFlow} focusNodeId={NODE.id} focusSequence={1} />,
    )

    rendered.rerender(
      <ViewportNavigationHarness
        reactFlow={{ ...reactFlow, viewportInitialized: true }}
        focusNodeId={NODE.id}
        focusSequence={2}
      />,
    )
    act(flushAnimationFrames)

    expect(reactFlow.setCenter).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reactFlow.setViewport).mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(reactFlow.setCenter).mock.invocationCallOrder[0],
    )
  })
})
