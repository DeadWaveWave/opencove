import { act } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveArrangeWrapWidth,
  useWorkspaceCanvasArrange,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useArrange'
import { replaceWorkspaceSpaces } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const reactFlow = {
  setViewport: vi.fn(),
  fitView: vi.fn(),
} as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>

function useArrangeUnderTest({ workspaceId, canvasState, nodeStore }: CanvasNodeStoreContext) {
  return {
    arrange: useWorkspaceCanvasArrange({
      reactFlow,
      focusNodeTargetZoom: 1,
      nodesRef: nodeStore.nodesRef,
      spacesRef: canvasState.spacesRef,
      setNodes: nodeStore.setNodes,
      onSpacesChange: spaces => replaceWorkspaceSpaces(workspaceId, spaces),
      standardWindowSizeBucket: 'regular',
    }),
  }
}

describe('workspace canvas arrange hook', () => {
  it('derives wrap width from aspect ratio instead of absolute viewport size', () => {
    expect(resolveArrangeWrapWidth({ width: 1440, height: 900 })).toBe(
      resolveArrangeWrapWidth({ width: 2880, height: 1800 }),
    )
    expect(resolveArrangeWrapWidth({ width: 1600, height: 1000 })).toBe(
      resolveArrangeWrapWidth({ width: 800, height: 500 }),
    )
  })

  it('uses narrower wrap hints for narrower aspect ratios', () => {
    const widescreen = resolveArrangeWrapWidth({ width: 1600, height: 900 })
    const standard = resolveArrangeWrapWidth({ width: 1200, height: 900 })

    expect(widescreen).toBeGreaterThan(standard)
  })

  // The Spaces a layout returns are the ones it was given: arranging nodes alone must write
  // nodes and no Spaces, however the store re-sanitizes the Spaces after the nodes are written.
  it('writes no Spaces when arranging leaves them as they were', () => {
    const nodes = createRowNodes(['a', 'b', 'c']).map((node, index) => ({
      ...node,
      position: { x: index * 37, y: index * 11 },
    }))
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [],
    })
    const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })
    const spacesBefore = harness.readStoreDocument().spaces
    harness.notifications.mockClear()

    act(() => view.result.current.arrange.arrangeCanvas())

    expect(harness.readStoreDocument().nodes).not.toEqual(nodes)
    // The node write stores equal Spaces again, so the array is a new one: what counts is that
    // nothing wrote them afterwards.
    expect(harness.readStoreDocument().spaces).toEqual(spacesBefore)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
  })

  it('stores the Spaces the layout moved', () => {
    const nodes = createRowNodes(['a', 'b']).map(node => ({ ...node, position: { x: 13, y: 7 } }))
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [createSpace('far', { x: 9000, y: 9000, width: 400, height: 300 })],
    })
    const view = renderCanvasNodeStore(harness, { extend: useArrangeUnderTest })

    act(() => view.result.current.arrange.arrangeCanvas())

    expect(harness.readStoreDocument().spaces[0].rect).not.toEqual({
      x: 9000,
      y: 9000,
      width: 400,
      height: 300,
    })
  })
})
