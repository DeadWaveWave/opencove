import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { resolveCanvasDocumentBase } from '../../../src/contexts/workspace/presentation/renderer/utils/canvasDocumentBase'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

const live = { includeLivePositions: true }
const settled = { includeLivePositions: false }

function node(id: string, overrides: Partial<Node<TerminalNodeData>> = {}) {
  return { ...pixelNode(), id, ...overrides } as Node<TerminalNodeData>
}

describe('resolveCanvasDocumentBase', () => {
  it('returns the document nodes when no canvas node differs', () => {
    const documentNodes = [node('a'), node('b')]
    expect(resolveCanvasDocumentBase(documentNodes, [...documentNodes], settled)).toBe(
      documentNodes,
    )
    expect(resolveCanvasDocumentBase(documentNodes, [], settled)).toBe(documentNodes)
  })

  it('keeps the canvas object for a copy that differs only in selected or dragHandle', () => {
    const documentNodes = [node('a'), node('b')]
    const decorated = { ...documentNodes[0], selected: true, dragHandle: '.drag' }
    const result = resolveCanvasDocumentBase(documentNodes, [decorated, documentNodes[1]], settled)
    expect(result).not.toBe(documentNodes)
    expect(result[0]).toBe(decorated)
    expect(result[1]).toBe(documentNodes[1])
  })

  it('keeps the canvas object when only the live position differs during a gesture', () => {
    const documentNodes = [node('a')]
    const moved = { ...documentNodes[0], position: { x: 500, y: 600 } }
    const result = resolveCanvasDocumentBase(documentNodes, [moved], live)
    expect(result[0]).toBe(moved)
  })

  it('ignores the canvas position when no gesture is live', () => {
    const documentNodes = [node('a')]
    const moved = { ...documentNodes[0], position: { x: 500, y: 600 } }
    const result = resolveCanvasDocumentBase(documentNodes, [moved], settled)
    expect(result).toBe(documentNodes)
  })

  it('copies selected, dragHandle and the live position onto a document node that changed elsewhere', () => {
    const documentNodes = [node('a')]
    const stale = {
      ...documentNodes[0],
      data: { ...documentNodes[0].data, title: 'stale title' },
      selected: true,
      dragHandle: '.drag',
      position: { x: 500, y: 600 },
    }
    const result = resolveCanvasDocumentBase(documentNodes, [stale], live)
    expect(result[0]).not.toBe(stale)
    expect(result[0].data).toBe(documentNodes[0].data)
    expect(result[0].selected).toBe(true)
    expect(result[0].dragHandle).toBe('.drag')
    expect(result[0].position).toEqual({ x: 500, y: 600 })

    const settledResult = resolveCanvasDocumentBase(documentNodes, [stale], settled)
    expect(settledResult[0].selected).toBe(true)
    expect(settledResult[0].position).toBe(documentNodes[0].position)
  })

  it('returns the document node itself when the copied fields are already equal', () => {
    const documentNodes = [node('a', { selected: true, dragHandle: '.drag' })]
    const stale = {
      ...documentNodes[0],
      data: { ...documentNodes[0].data, title: 'stale title' },
    }
    const result = resolveCanvasDocumentBase(documentNodes, [stale], settled)
    expect(result).toBe(documentNodes)
    expect(result[0]).toBe(documentNodes[0])
  })

  it('drops canvas nodes that are not in the document and keeps document order', () => {
    const documentNodes = [node('b'), node('a')]
    const canvasNodes = [node('c'), { ...documentNodes[1], selected: true }, documentNodes[0]]
    const result = resolveCanvasDocumentBase(documentNodes, canvasNodes, settled)
    expect(result.map(item => item.id)).toEqual(['b', 'a'])
    expect(result[0]).toBe(documentNodes[0])
    expect(result[1]).toBe(canvasNodes[1])
  })

  it('keeps document nodes that the canvas has not seen yet', () => {
    const documentNodes = [node('a'), node('fresh')]
    const result = resolveCanvasDocumentBase(documentNodes, [documentNodes[0]], settled)
    expect(result).toBe(documentNodes)
  })
})
