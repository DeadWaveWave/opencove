import React from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceCanvasNodesStore } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore'
import { useWorkspaceCanvasNodeDeleteConfirmation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDeleteConfirmation'
import { subscribeWorkspaceNodesClosed } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeClosureEvents'
import { pixelNode } from './workspacePixelLayer.fixtures'

const mocks = vi.hoisted(() => ({ cleanup: vi.fn() }))
vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/nodeRuntimeCleanup', () => ({
  cleanupNodeRuntimeArtifacts: mocks.cleanup,
}))

function renderStore(
  nodes = [pixelNode()],
  onNodesChange = vi.fn(),
  onRequestPersistFlush = vi.fn(),
) {
  const requestNodeDeleteRef = { current: (_nodeIds: string[]) => undefined }
  return renderHook(
    ({ currentNodes }) => {
      const store = useWorkspaceCanvasNodesStore({
        nodes: currentNodes,
        spacesRef: { current: [] },
        onNodesChange,
        onSpacesChange: vi.fn(),
        onRequestPersistFlush,
        standardWindowSizeBucket: 'regular',
        browserDefaultMode: 'iframe',
      })
      const confirmation = useWorkspaceCanvasNodeDeleteConfirmation({
        nodesRef: store.nodesRef,
        spacesRef: { current: [] },
        closeNode: store.closeNode,
        requestNodeDeleteRef,
      })
      return { ...store, confirmation, requestNodeDeleteRef }
    },
    {
      initialProps: { currentNodes: nodes },
      wrapper: ({ children }): React.JSX.Element => (
        <ReactFlowProvider>{children}</ReactFlowProvider>
      ),
    },
  )
}

describe('node store successful closure', () => {
  let unsubscribe: () => void
  beforeEach(() => {
    vi.clearAllMocks()
    unsubscribe = () => undefined
  })
  afterEach(() => {
    unsubscribe()
    cleanup()
    vi.restoreAllMocks()
  })

  it('publishes once after commit and starts PTY cleanup without waiting for any visual or kill promise', async () => {
    const order: string[] = []
    mocks.cleanup.mockImplementation(() => {
      order.push('cleanup')
    })
    const kill = vi.fn(() => {
      order.push('kill')
      return new Promise<void>(() => undefined)
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { pty: { kill } },
    })
    const view = renderStore(
      [pixelNode()],
      vi.fn(() => {
        order.push('commit')
      }),
      vi.fn(() => {
        order.push('flush')
      }),
    )
    const closed = vi.fn((ids: string[]) => {
      expect(ids).toEqual(['terminal-1'])
      expect(view.result.current.nodesRef.current).toEqual([])
      order.push('closed')
    })
    unsubscribe = subscribeWorkspaceNodesClosed(closed)
    await act(() => view.result.current.closeNode('terminal-1'))
    expect(order).toEqual(['cleanup', 'kill', 'commit', 'closed', 'flush'])
    expect(closed).toHaveBeenCalledTimes(1)
    await act(() => view.result.current.closeNode('terminal-1'))
    expect(closed).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it.each(['image', 'website'] as const)(
    'notifies %s removal only after its existing cleanup completes',
    async kind => {
      let release: () => void = () => undefined
      const nativeCleanup = vi.fn(
        () =>
          new Promise<void>(resolve => {
            release = resolve
          }),
      )
      Object.defineProperty(window, 'opencoveApi', {
        configurable: true,
        value: {
          workspace: { deleteCanvasImage: nativeCleanup },
          websiteWindow: { close: nativeCleanup },
        },
      })
      const node = pixelNode({
        kind,
        sessionId: '',
        image:
          kind === 'image'
            ? {
                assetId: 'asset',
                mimeType: 'image/png',
                fileName: null,
                naturalWidth: 10,
                naturalHeight: 10,
              }
            : null,
      })
      const committed = vi.fn()
      const view = renderStore([node], committed)
      const closed = vi.fn()
      unsubscribe = subscribeWorkspaceNodesClosed(closed)
      const closing = view.result.current.closeNode(node.id)
      expect(nativeCleanup).toHaveBeenCalledTimes(1)
      expect(committed).not.toHaveBeenCalled()
      expect(closed).not.toHaveBeenCalled()
      await act(async () => {
        release()
        await closing
      })
      expect(view.result.current.nodesRef.current).toEqual([])
      expect(closed).toHaveBeenCalledExactlyOnceWith([node.id])
    },
  )

  it('uses the latest committed nodes after an async cleanup, so a vanished node is not closed again', async () => {
    let release: () => void = () => undefined
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        websiteWindow: {
          close: () =>
            new Promise<void>(resolve => {
              release = resolve
            }),
        },
      },
    })
    const view = renderStore([pixelNode({ kind: 'website', sessionId: '' })])
    const closed = vi.fn()
    unsubscribe = subscribeWorkspaceNodesClosed(closed)
    const closing = view.result.current.closeNode('terminal-1')
    view.rerender({ currentNodes: [] })
    expect(closed).not.toHaveBeenCalled()
    await act(async () => {
      release()
      await closing
    })
    expect(closed).not.toHaveBeenCalled()
  })

  it('does not treat missing nodes, cancelled confirmation or hydration changes as successful close', async () => {
    const note = pixelNode({ kind: 'note', sessionId: '' })
    const view = renderStore([note])
    const closed = vi.fn()
    unsubscribe = subscribeWorkspaceNodesClosed(closed)
    await act(() => view.result.current.closeNode('missing'))
    act(() => view.result.current.requestNodeDeleteRef.current([note.id]))
    expect(view.result.current.confirmation.nodeDeleteConfirmation).not.toBeNull()
    act(() => view.result.current.confirmation.setNodeDeleteConfirmation(null))
    await act(() => view.result.current.confirmation.confirmNodeDelete())
    view.rerender({ currentNodes: [] })
    expect(closed).not.toHaveBeenCalled()
  })
})
