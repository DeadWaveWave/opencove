import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { useWorkspaceCanvasState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasState'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

describe('setNodes flush option', () => {
  it('flushes once for { flush: true }, also when the updater changes nothing, and not without it', () => {
    const harness = createCanvasDocumentHarness({ nodes: createRowNodes(['a', 'b']) })
    const view = renderCanvasNodeStore(harness)
    const rename = (title: string) => (prev: ReturnType<typeof createRowNodes>) =>
      prev.map(node => (node.id === 'a' ? { ...node, data: { ...node.data, title } } : node))

    act(() => view.result.current.nodeStore.setNodes(prev => prev, { flush: true }))
    expect(harness.flush).toHaveBeenCalledTimes(1)

    act(() => view.result.current.nodeStore.setNodes(prev => prev))
    act(() => view.result.current.nodeStore.setNodes(rename('one')))
    expect(harness.flush).toHaveBeenCalledTimes(1)

    act(() => view.result.current.nodeStore.setNodes(rename('two'), { flush: true }))
    expect(harness.flush).toHaveBeenCalledTimes(2)
    expect(harness.readStoreDocument().nodes[0].data.title).toBe('two')
  })
})

describe('spacesRef getter', () => {
  it('reads the Spaces of the workspace the canvas shows after a switch', () => {
    const harness = createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      spaces: [createSpace('space-a', null)],
    })
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        { ...state.workspaces[0], id: 'workspace-b', spaces: [createSpace('space-b', null)] },
      ],
    }))
    let shown = 'workspace-a'
    const noNodes: never[] = []
    const view = renderInCanvasDocument(
      () =>
        useWorkspaceCanvasState({
          workspaceId: shown,
          nodes: noNodes,
          spaces: useAppStore.getState().workspaces.find(item => item.id === shown)?.spaces ?? [],
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
      { workspaceId: () => shown },
    )
    expect(view.result.current.spacesRef.current.map(item => item.id)).toEqual(['space-a'])

    shown = 'workspace-b'
    view.rerender()

    expect(view.result.current.spacesRef.current.map(item => item.id)).toEqual(['space-b'])
    expect(harness.workspaceId).toBe('workspace-a')
  })
})
