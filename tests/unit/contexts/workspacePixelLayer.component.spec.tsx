import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pixelNode } from './workspacePixelLayer.fixtures'
import { WorkspacePixelLayer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspacePixelLayer'
import {
  publishWorkspaceNodeCreated,
  publishWorkspaceNodeCreationPrepared,
  publishWorkspaceNodeCreationCancelled,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeCreationEvents'
import { publishWorkspaceNodesClosed } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeClosureEvents'
import type { TerminalDataEvent } from '../../../src/shared/contracts/dto'

const mocks = vi.hoisted(() => ({
  onData: vi.fn(),
  unsubscribe: vi.fn(),
  store: { getState: vi.fn(), subscribe: vi.fn(), setState: vi.fn() },
}))
vi.mock('@xyflow/react', () => ({ useStoreApi: () => mocks.store }))
vi.mock('@app/renderer/shell/utils/ptyEventHub', () => ({ getPtyEventHub: () => mocks }))

function createNode(nodeId: string) {
  publishWorkspaceNodeCreationPrepared([nodeId], performance.now())
  publishWorkspaceNodeCreated(nodeId)
}

describe('workspace pixel layer lifecycle', () => {
  let output: (event: TerminalDataEvent) => void
  let motionChange: () => void
  let storeChange: () => void
  let intersect: (entries: Array<{ isIntersecting: boolean }>) => void
  let now: number
  let reduced: boolean
  let visible: boolean
  let frames: Map<number, FrameRequestCallback>
  const disconnect = vi.fn()
  const unsubscribeStore = vi.fn()
  const removeMediaListener = vi.fn()
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
  const tick = (at: number) => {
    now = at
    const pending = [...frames.values()]
    frames.clear()
    act(() => pending.forEach(callback => callback(now)))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    vi.stubGlobal(
      'CSSStyleSheet',
      class {
        cssRules = []
        replaceSync = vi.fn()
      },
    )
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      writable: true,
      value: [],
    })
    now = 0
    reduced = false
    visible = true
    frames = new Map()
    let frameId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id)
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      visible ? 'visible' : 'hidden',
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      get matches() {
        return reduced
      },
      addEventListener: (_event: string, listener: () => void) => {
        motionChange = listener
      },
      removeEventListener: removeMediaListener,
    } as MediaQueryList)
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof intersect) {
          intersect = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    mocks.onData.mockImplementation(listener => {
      output = listener
      return mocks.unsubscribe
    })
    mocks.store.getState.mockReturnValue({
      transform: [0, 0, 1],
      width: 1000,
      height: 800,
      nodeLookup: new Map(),
    })
    mocks.store.subscribe.mockImplementation(listener => {
      storeChange = listener
      return unsubscribeStore
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the visible field flowing without inventing output activity or writing runtime state', () => {
    const node = pixelNode()
    const before = structuredClone(node)
    const view = render(<WorkspacePixelLayer nodes={[node]} />)
    const canvas = view.getByTestId('workspace-pixel-layer')
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    tick(0)
    expect(context.fillRect).toHaveBeenCalled()
    expect(frames.size).toBe(1)
    act(() => output({ sessionId: 'other', data: 'Read Edit Bash' }))
    expect(frames.size).toBe(1)
    for (let i = 0; i < 100; i++) {
      output({ sessionId: 'session-1', data: '\u001b[2Janything' })
    }
    expect(frames.size).toBe(1)
    tick(40)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'output')
    tick(1100)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    expect(frames.size).toBe(1)
    expect(node).toEqual(before)
    expect(mocks.store.setState).not.toHaveBeenCalled()
    view.unmount()
    expect(frames.size).toBe(0)
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    expect(unsubscribeStore).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(removeMediaListener).toHaveBeenCalledOnce()
  })

  it('clears output on reduced motion, background visibility, offscreen and session rebinding', () => {
    const view = render(<WorkspacePixelLayer nodes={[pixelNode()]} />)
    const canvas = view.getByTestId('workspace-pixel-layer')
    tick(0)
    output({ sessionId: 'session-1', data: 'output' })
    tick(40)
    reduced = true
    act(() => motionChange())
    tick(80)
    expect(canvas).toHaveAttribute('data-cove-pixel-motion', 'static')
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    output({ sessionId: 'session-1', data: 'still delivered by the hub' })
    expect(frames.size).toBe(0)
    reduced = false
    act(() => motionChange())
    tick(120)
    output({ sessionId: 'session-1', data: 'output' })
    visible = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(frames.size).toBe(0)
    expect(canvas).toHaveAttribute('data-cove-pixel-visibility', 'hidden')
    const hiddenClearCount = context.clearRect.mock.calls.length
    act(() => {
      storeChange()
      storeChange()
      storeChange()
    })
    expect(context.clearRect).toHaveBeenCalledTimes(hiddenClearCount)
    output({ sessionId: 'session-1', data: 'background output' })
    visible = true
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    tick(160)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    act(() => intersect([{ isIntersecting: false }]))
    act(() => storeChange())
    expect(frames.size).toBe(0)
    act(() => intersect([{ isIntersecting: true }]))
    tick(200)
    output({ sessionId: 'session-1', data: 'before rebind' })
    view.rerender(<WorkspacePixelLayer nodes={[pixelNode({ sessionId: 'session-2' })]} />)
    tick(240)
    expect(canvas).toHaveAttribute('data-cove-pixel-activity', 'idle')
    view.unmount()
    output({ sessionId: 'session-2', data: 'late callback' })
    expect(frames.size).toBe(0)
  })
  it('assembles explicit new nodes while keeping their DOM clickable and immediately reveals on input', () => {
    const node = pixelNode()
    const renderScene = (nodes: (typeof node)[]) => (
      <div>
        <WorkspacePixelLayer nodes={nodes} />
        <div className="react-flow__node" data-id={node.id}>
          <button>Node input</button>
        </div>
      </div>
    )
    const view = render(renderScene([]))
    tick(0)
    const foreground = view.getByTestId('workspace-pixel-assembly')
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    now = 100
    act(() => createNode(node.id))
    view.rerender(renderScene([node]))
    tick(140)
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
    expect(foreground).toHaveAttribute('data-cove-pixel-node-ids', node.id)
    const button = view.getByText('Node input')
    expect(button.closest('.react-flow__node')).not.toHaveAttribute('inert')
    fireEvent.pointerDown(button)
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    now = 1000
    act(() => createNode(node.id))
    tick(1040)
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
    fireEvent.keyDown(button, { key: 'x' })
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    view.unmount()
    act(() => createNode(node.id))
    expect(frames.size).toBe(0)
  })
  it('reveals for pane selection and keyboard navigation without canceling programmatic autofocus', () => {
    const node = pixelNode()
    const view = render(
      <div>
        <button data-testid="outside">Outside</button>
        <div className="react-flow">
          <WorkspacePixelLayer nodes={[node]} />
          <div className="react-flow__pane" data-testid="pane" />
          <div className="react-flow__node" data-id={node.id}>
            <input data-testid="node-input" />
          </div>
        </div>
      </div>,
    )
    const foreground = view.getByTestId('workspace-pixel-assembly')
    tick(0)
    now = 100
    act(() => createNode(node.id))
    tick(140)
    fireEvent.focusIn(view.getByTestId('node-input'))
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
    fireEvent.keyDown(view.getByTestId('outside'), { key: 'Tab' })
    fireEvent.focusIn(view.getByTestId('node-input'))
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    now = 1000
    act(() => createNode(node.id))
    tick(1040)
    fireEvent.pointerDown(view.getByTestId('pane'))
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    view.unmount()
  })

  it('prepares transparent CSS before node commit and clears failed creation immediately', () => {
    const view = render(<WorkspacePixelLayer nodes={[]} />)
    const sheet = document.adoptedStyleSheets[0]
    expect(sheet).toBeDefined()
    act(() => publishWorkspaceNodeCreationPrepared(['not-yet-mounted'], 0))
    expect(sheet.replaceSync).toHaveBeenLastCalledWith(
      expect.stringContaining('data-id="not-yet-mounted"'),
    )
    expect(sheet.replaceSync).toHaveBeenLastCalledWith(
      expect.stringContaining('linear-gradient(transparent, transparent)'),
    )
    act(() => publishWorkspaceNodeCreationCancelled(['not-yet-mounted']))
    expect(sheet.replaceSync).toHaveBeenLastCalledWith('')
    tick(40)
    expect(view.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
      'data-cove-pixel-assembly',
      'idle',
    )
    view.unmount()
    expect(document.adoptedStyleSheets).toEqual([])
  })

  it('does not consume reveal time before a delayed animation callback can present the frame', () => {
    const node = pixelNode()
    const view = render(
      <div>
        <WorkspacePixelLayer nodes={[node]} />
        <div className="react-flow__node" data-id={node.id}>
          <input />
        </div>
      </div>,
    )
    act(() => createNode(node.id))
    const queued = [...frames.values()]
    frames.clear()
    now = 200
    // A busy earlier callback has made the browser-provided RAF timestamp stale.
    act(() => queued.forEach(callback => callback(40)))
    tick(480)
    expect(view.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
      'data-cove-pixel-assembly',
      'assembling',
    )
    tick(600)
    expect(view.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
      'data-cove-pixel-assembly',
      'idle',
    )
  })

  it('scatters a removed node from cached geometry while preserving survivor input and the single scheduler', () => {
    const node = pixelNode()
    const survivor = { ...pixelNode(), id: 'survivor' }
    const renderScene = (nodes: (typeof node)[]) => (
      <div>
        <WorkspacePixelLayer nodes={nodes} />
        <input data-testid="survivor-input" />
      </div>
    )
    const view = render(renderScene([node, survivor]))
    const foreground = view.getByTestId('workspace-pixel-assembly')
    tick(0)
    now = 100
    // Simulate the synchronous owner/React commit happening before its close notification.
    view.rerender(renderScene([survivor]))
    act(() => publishWorkspaceNodesClosed([node.id]))
    tick(140)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'bursting')
    expect(foreground).toHaveAttribute('data-cove-pixel-burst-node-ids', node.id)
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    expect(frames.size).toBe(1)
    fireEvent.pointerDown(view.getByTestId('survivor-input'))
    fireEvent.change(view.getByTestId('survivor-input'), { target: { value: 'still usable' } })
    expect(view.getByTestId('survivor-input')).toHaveValue('still usable')
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'bursting')
    tick(540)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle')
    expect(foreground).toHaveAttribute('data-cove-pixel-burst-node-ids', '')
    expect(frames.size).toBe(1)
    expect(mocks.store.setState).not.toHaveBeenCalled()
    view.unmount()
    act(() => publishWorkspaceNodesClosed([survivor.id]))
    expect(frames.size).toBe(0)
  })

  it('does not infer a close from hydration and discards bursts when hidden or reduced', () => {
    const node = pixelNode()
    const view = render(<WorkspacePixelLayer nodes={[node]} />)
    const foreground = view.getByTestId('workspace-pixel-assembly')
    tick(0)
    view.rerender(<WorkspacePixelLayer nodes={[]} />)
    tick(40)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle')
    view.rerender(<WorkspacePixelLayer nodes={[node]} />)
    act(() => publishWorkspaceNodesClosed([node.id]))
    tick(80)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'bursting')
    visible = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle')
    expect(frames.size).toBe(0)
    act(() => publishWorkspaceNodesClosed([node.id]))
    visible = true
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    tick(120)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle')
    reduced = true
    act(() => motionChange())
    act(() => publishWorkspaceNodesClosed([node.id]))
    tick(160)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle')
    expect(frames.size).toBe(0)
  })

  it('controls creation, closing and background independently without keeping an idle frame loop', () => {
    const node = pixelNode()
    const renderScene = (nodes: (typeof node)[], creation: boolean, closing: boolean) => (
      <div>
        <WorkspacePixelLayer
          nodes={nodes}
          options={{ background: false, creation, closing, working: false }}
        />
        <div className="react-flow__node" data-id={node.id}>
          <input />
        </div>
      </div>
    )
    const view = render(renderScene([], true, false))
    const foreground = view.getByTestId('workspace-pixel-assembly')
    tick(0)
    expect(frames.size).toBe(0)
    expect(view.getByTestId('workspace-pixel-layer')).toHaveAttribute('hidden')
    output({ sessionId: node.data.sessionId, data: 'background is disabled' })
    expect(frames.size).toBe(0)
    now = 100
    act(() => createNode(node.id))
    view.rerender(renderScene([node], true, false))
    tick(140)
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
    expect(frames.size).toBe(1)
    // Enabling close feedback does not cancel an in-progress creation.
    view.rerender(renderScene([node], true, true))
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'assembling')
    view.rerender(renderScene([node], false, true))
    expect(foreground).toHaveAttribute('data-cove-pixel-assembly', 'idle')
    tick(200)
    expect(frames.size).toBe(0)
    view.rerender(renderScene([], false, true))
    act(() => publishWorkspaceNodesClosed([node.id]))
    tick(240)
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'bursting')
    view.rerender(renderScene([], false, false))
    expect(foreground).toHaveAttribute('data-cove-pixel-burst', 'idle')
    expect(frames.size).toBe(0)
  })

  it('animates Working independently, stops on idle, reduced motion, hiding and disable', () => {
    const options = { background: false, creation: false, closing: false, working: true }
    const node = pixelNode({ kind: 'agent', status: 'running' })
    const view = render(<WorkspacePixelLayer nodes={[node]} options={options} />)
    const canvas = view.getByTestId('workspace-pixel-layer')
    tick(0)
    expect(canvas).toHaveAttribute('data-cove-pixel-working-node-ids', node.id)
    expect(canvas).not.toHaveAttribute('hidden')
    expect(frames.size).toBe(1)
    reduced = true
    act(() => motionChange())
    tick(40)
    expect(canvas).toHaveAttribute('data-cove-pixel-working-node-ids', '')
    expect(frames.size).toBe(0)
    reduced = false
    act(() => motionChange())
    tick(80)
    expect(frames.size).toBe(1)
    visible = false
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(frames.size).toBe(0)
    expect(canvas).toHaveAttribute('data-cove-pixel-working-node-ids', '')
    visible = true
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    tick(120)
    expect(frames.size).toBe(1)
    view.rerender(
      <WorkspacePixelLayer
        nodes={[pixelNode({ kind: 'agent', status: 'standby' })]}
        options={options}
      />,
    )
    tick(160)
    expect(canvas).toHaveAttribute('data-cove-pixel-working-node-ids', '')
    expect(canvas).toHaveAttribute('hidden')
    expect(frames.size).toBe(0)
    view.rerender(<WorkspacePixelLayer nodes={[node]} options={options} />)
    tick(200)
    expect(frames.size).toBe(1)
    view.rerender(<WorkspacePixelLayer nodes={[node]} options={{ ...options, working: false }} />)
    expect(frames.size).toBe(0)
    expect(canvas).toHaveAttribute('data-cove-pixel-working-node-ids', '')
    view.unmount()
    expect(frames.size).toBe(0)
  })
})
