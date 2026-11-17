import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
} from '../../support/canvasDocumentHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'

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
