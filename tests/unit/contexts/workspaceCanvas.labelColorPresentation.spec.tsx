import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceNodeKind,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { useWorkspaceCanvasLabelColorFilter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useLabelColorFilter'
import { pixelNode } from './workspacePixelLayer.fixtures'

const kinds: WorkspaceNodeKind[] = [
  'terminal',
  'agent',
  'task',
  'note',
  'document',
  'role',
  'website',
  'image',
]
const labelAttribute = (node: Node<TerminalNodeData>) =>
  (node.domAttributes as Record<string, unknown> | undefined)?.['data-cove-label-color']

describe('canvas label color presentation', () => {
  it('keeps theme-decorated windows outside the explicit label inventory', () => {
    const nodes = kinds.map(kind => ({ ...pixelNode({ kind }), id: kind }))
    const { result, rerender } = renderHook(
      ({ items }) => useWorkspaceCanvasLabelColorFilter({ nodes: items, edges: [], spaces: [] }),
      { initialProps: { items: nodes } },
    )
    expect(result.current.usedLabelColors).toEqual([])
    expect(result.current.filteredNodes.every(node => labelAttribute(node) === undefined)).toBe(
      true,
    )
    expect(result.current.filteredNodes.every(node => node.data.effectiveLabelColor === null)).toBe(
      true,
    )
    rerender({
      items: nodes.map(node =>
        node.id === 'note'
          ? { ...node, data: { ...node.data, labelColorOverride: 'red' as const } }
          : node,
      ),
    })
    expect(result.current.usedLabelColors).toEqual(['red'])
    expect(nodes.every(node => node.data.labelColorOverride === undefined)).toBe(true)
  })

  it('projects the existing label to every window kind without changing source nodes or geometry', () => {
    const nodes = kinds.map(kind => ({
      ...pixelNode({ kind, labelColorOverride: 'green' }),
      id: kind,
      selected: true,
      domAttributes: { 'aria-describedby': `${kind}-description` },
    }))
    const snapshot = structuredClone(nodes)
    const { result } = renderHook(() =>
      useWorkspaceCanvasLabelColorFilter({ nodes, edges: [], spaces: [] }),
    )
    expect(result.current.filteredNodes).toHaveLength(kinds.length)
    for (const node of result.current.filteredNodes) {
      expect(labelAttribute(node)).toBe('green')
      expect(node.domAttributes?.['aria-describedby']).toBe(`${node.id}-description`)
      expect(node.selected).toBe(true)
      expect(node.position).toEqual(nodes.find(source => source.id === node.id)?.position)
      expect(node.data).toEqual({
        ...nodes.find(source => source.id === node.id)?.data,
        effectiveLabelColor: 'green',
      })
    }
    expect(nodes).toEqual(snapshot)
  })

  it('updates and clears old appearance attributes when a label changes or is removed', () => {
    const initial = pixelNode({ labelColorOverride: 'red' })
    const { result, rerender } = renderHook(
      ({ node }) => useWorkspaceCanvasLabelColorFilter({ nodes: [node], edges: [], spaces: [] }),
      { initialProps: { node: initial } },
    )
    expect(labelAttribute(result.current.filteredNodes[0])).toBe('red')
    const painted = result.current.filteredNodes[0]
    rerender({ node: { ...painted, data: { ...painted.data, labelColorOverride: 'blue' } } })
    expect(labelAttribute(result.current.filteredNodes[0])).toBe('blue')
    const changed = result.current.filteredNodes[0]
    rerender({ node: { ...changed, data: { ...changed.data, labelColorOverride: 'none' } } })
    expect(labelAttribute(result.current.filteredNodes[0])).toBeUndefined()
    rerender({ node: { ...changed, data: { ...changed.data, labelColorOverride: null } } })
    expect(labelAttribute(result.current.filteredNodes[0])).toBeUndefined()
  })

  it('keeps filtering behavior and supplied DOM attributes when projecting a label', () => {
    const red = { ...pixelNode({ labelColorOverride: 'red' }), id: 'red' }
    const blue = {
      ...pixelNode({ labelColorOverride: 'blue' }),
      id: 'blue',
      className: 'existing',
      domAttributes: { 'aria-describedby': 'blue-description' },
    }
    const { result } = renderHook(() =>
      useWorkspaceCanvasLabelColorFilter({ nodes: [red, blue], edges: [], spaces: [] }),
    )
    act(() => result.current.setLabelColorFilter('red'))
    const filtered = result.current.filteredNodes.find(node => node.id === 'blue')!
    expect(labelAttribute(filtered)).toBe('blue')
    expect(filtered.domAttributes?.['aria-describedby']).toBe('blue-description')
    expect(filtered.className).toBe('existing cove-node--filtered-out')
    expect(filtered.style?.pointerEvents).toBe('none')
    expect(result.current.filteredNodes.find(node => node.id === 'red')?.className).toBeUndefined()
  })
})
