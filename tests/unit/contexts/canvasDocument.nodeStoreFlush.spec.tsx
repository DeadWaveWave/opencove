import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
} from '../../support/canvasDocumentHarness'
import { createRowNodes } from '../../support/canvasSelectionFixtures'

describe('setNodes flush option', () => {
  it('flushes once for { flush: true } on a write that changes something, never for one that changes nothing or without it', () => {
    const harness = createCanvasDocumentHarness({ nodes: createRowNodes(['a', 'b']) })
    const view = renderCanvasNodeStore(harness)
    const rename = (title: string) => (prev: ReturnType<typeof createRowNodes>) =>
      prev.map(node => (node.id === 'a' ? { ...node, data: { ...node.data, title } } : node))

    // The first write gives the row nodes their initial sizes, which is a write; nothing else
    // changes after it.
    act(() => view.result.current.writer.updateNodes(prev => prev))
    act(() => view.result.current.writer.updateNodes(prev => prev, { flush: true }))
    expect(harness.flush).not.toHaveBeenCalled()

    act(() => view.result.current.writer.updateNodes(prev => prev))
    act(() => view.result.current.writer.updateNodes(rename('one')))
    expect(harness.flush).not.toHaveBeenCalled()

    act(() => view.result.current.writer.updateNodes(rename('two'), { flush: true }))
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(harness.readStoreDocument().nodes[0].data.title).toBe('two')
  })
})
