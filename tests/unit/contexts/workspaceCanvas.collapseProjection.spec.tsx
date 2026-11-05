import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCollapsedCanvasProjection } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCollapsedCanvasProjection'
import { createCollapsedNodesProjector } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { pixelNode } from './workspacePixelLayer.fixtures'

describe('live collapsed canvas projection', () => {
  it('invalidates cached presentation when disclosure changes, including legacy Space hiding', () => {
    const project = createCollapsedNodesProjector()
    const node = pixelNode()
    const spaces = [{ id: 'space', nodeIds: [node.id] }] as Parameters<typeof project>[1]
    const expanded = project([node], spaces, { collapsedNodeIds: {}, collapsedSpaceIds: {} })[0]
    const compact = project([node], spaces, {
      collapsedNodeIds: { [node.id]: true },
      collapsedSpaceIds: {},
    })[0]
    expect(compact).toMatchObject({ width: 112, height: 96, data: { width: 300, height: 200 } })
    expect(compact.data).not.toBe(expanded.data)
    const hidden = project([node], spaces, {
      collapsedNodeIds: {},
      collapsedSpaceIds: { space: true },
    })[0]
    expect(hidden).toMatchObject({
      width: 0,
      height: 0,
      selected: false,
      data: { collapsePresentation: { spaceHidden: true } },
    })
    expect(project([node], spaces, { collapsedNodeIds: {}, collapsedSpaceIds: {} })[0]).toEqual(
      expanded,
    )
  })

  it('keeps stationary windows and moved window data stable across drag frames', () => {
    const nodes = [pixelNode(), { ...pixelNode(), id: 'peer' }]
    const { result, rerender } = renderHook(
      ({ items }) =>
        useCollapsedCanvasProjection({
          nodes: items,
          edges: [],
          spaces: [],
          spaceVisuals: [],
          spaceFramePreview: null,
        }),
      { initialProps: { items: nodes } },
    )
    const before = result.current.nodes
    const moved = { ...nodes[0], position: { x: 300, y: 250 } }
    rerender({ items: [moved, nodes[1]] })
    expect(result.current.nodes[0].position).toBe(moved.position)
    expect(result.current.nodes[0].data).toBe(before[0].data)
    expect(result.current.nodes[1]).toBe(before[1])
    const changed = { ...moved, data: { ...moved.data, title: 'Updated while dragging' } }
    rerender({ items: [changed, nodes[1]] })
    expect(result.current.nodes[0].data.title).toBe(changed.data.title)
    expect(result.current.nodes[0].data).not.toBe(before[0].data)
  })
})
