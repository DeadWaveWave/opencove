import { describe, expect, it, vi } from 'vitest'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import type { SelectionDraftState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import { applySelectionDraft } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSelectionDraft.helpers'

function createNode(
  id: string,
  options: { x: number; y: number; width?: number; height?: number; selected?: boolean },
): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminalNode',
    position: { x: options.x, y: options.y },
    selected: options.selected ?? false,
    data: {
      id,
      title: id,
      kind: 'terminal',
      status: null,
      sessionId: id,
      width: options.width ?? 120,
      height: options.height ?? 80,
      executionDirectory: null,
      expectedDirectory: null,
      lastError: null,
    },
  } as Node<TerminalNodeData>
}

function createStateSetter<T>(initial: T) {
  let value = initial
  const set = vi.fn((next: T | ((previous: T) => T)) => {
    value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next
  })

  return {
    get value() {
      return value
    },
    set,
  }
}

function createDraft(overrides: Partial<SelectionDraftState> = {}): SelectionDraftState {
  return {
    startX: 0,
    startY: 0,
    currentX: 250,
    currentY: 120,
    pointerId: 1,
    toggleSelection: false,
    selectedNodeIdsAtStart: [],
    selectedSpaceIdsAtStart: [],
    startSpaceId: null,
    phase: 'active',
    ...overrides,
  }
}

const identityReactFlow = {
  screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
} as ReactFlowInstance<Node<TerminalNodeData>>

describe('applySelectionDraft', () => {
  it('toggles intersecting nodes during shift marquee selection', () => {
    let nodes = [
      createNode('node-a', { x: 20, y: 20, selected: true }),
      createNode('node-b', { x: 160, y: 20, selected: false }),
    ]
    const selectedNodeIdsRef = { current: ['node-a'] }
    const selectedSpaceIdsRef = { current: [] as string[] }
    const selectedNodeIdsState = createStateSetter<string[]>(['node-a'])
    const selectedSpaceIdsState = createStateSetter<string[]>([])

    applySelectionDraft({
      draft: createDraft({
        toggleSelection: true,
        selectedNodeIdsAtStart: ['node-a'],
      }),
      reactFlow: identityReactFlow,
      spaces: [],
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes: updater => {
        nodes = updater(nodes)
      },
      setSelectedNodeIds: selectedNodeIdsState.set,
      setSelectedSpaceIds: selectedSpaceIdsState.set,
    })

    expect(nodes.find(node => node.id === 'node-a')?.selected).toBe(false)
    expect(nodes.find(node => node.id === 'node-b')?.selected).toBe(true)
    expect(selectedNodeIdsRef.current).toEqual(['node-b'])
    expect(selectedNodeIdsState.value).toEqual(['node-b'])
  })

  it('toggles intersecting spaces during shift marquee selection', () => {
    const selectedNodeIdsRef = { current: [] as string[] }
    const selectedSpaceIdsRef = { current: ['space-a'] }
    const selectedNodeIdsState = createStateSetter<string[]>([])
    const selectedSpaceIdsState = createStateSetter<string[]>(['space-a'])
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-a',
        name: 'A',
        directoryPath: '',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: {
          x: 40,
          y: 40,
          width: 140,
          height: 120,
        },
      },
    ]

    applySelectionDraft({
      draft: createDraft({
        currentX: 220,
        currentY: 200,
        toggleSelection: true,
        selectedSpaceIdsAtStart: ['space-a'],
      }),
      reactFlow: identityReactFlow,
      spaces,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes: updater => {
        updater([])
      },
      setSelectedNodeIds: selectedNodeIdsState.set,
      setSelectedSpaceIds: selectedSpaceIdsState.set,
    })

    expect(selectedSpaceIdsRef.current).toEqual([])
    expect(selectedSpaceIdsState.value).toEqual([])
    expect(selectedNodeIdsRef.current).toEqual([])
  })

  it('drops out-of-scope selected nodes during shift marquee selection inside a space', () => {
    let nodes = [
      createNode('node-in', { x: 40, y: 40, selected: false }),
      createNode('node-out', { x: 420, y: 40, selected: true }),
    ]
    const selectedNodeIdsRef = { current: ['node-out'] }
    const selectedSpaceIdsRef = { current: [] as string[] }
    const selectedNodeIdsState = createStateSetter<string[]>(['node-out'])
    const selectedSpaceIdsState = createStateSetter<string[]>([])
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['node-in'],
        rect: {
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
      },
    ]

    applySelectionDraft({
      draft: createDraft({
        toggleSelection: true,
        selectedNodeIdsAtStart: ['node-out'],
        startSpaceId: 'space-a',
      }),
      reactFlow: identityReactFlow,
      spaces,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes: updater => {
        nodes = updater(nodes)
      },
      setSelectedNodeIds: selectedNodeIdsState.set,
      setSelectedSpaceIds: selectedSpaceIdsState.set,
    })

    expect(nodes.find(node => node.id === 'node-in')?.selected).toBe(true)
    expect(nodes.find(node => node.id === 'node-out')?.selected).toBe(false)
    expect(selectedNodeIdsRef.current).toEqual(['node-in'])
    expect(selectedNodeIdsState.value).toEqual(['node-in'])
  })

  it('drops out-of-scope selected nodes during shift marquee selection outside spaces', () => {
    let nodes = [
      createNode('node-in', { x: 40, y: 40, selected: true }),
      createNode('node-out', { x: 420, y: 40, selected: false }),
    ]
    const selectedNodeIdsRef = { current: ['node-in'] }
    const selectedSpaceIdsRef = { current: [] as string[] }
    const selectedNodeIdsState = createStateSetter<string[]>(['node-in'])
    const selectedSpaceIdsState = createStateSetter<string[]>([])
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['node-in'],
        rect: {
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
      },
    ]

    applySelectionDraft({
      draft: createDraft({
        startX: 360,
        startY: 0,
        currentX: 640,
        currentY: 160,
        toggleSelection: true,
        selectedNodeIdsAtStart: ['node-in'],
        startSpaceId: null,
      }),
      reactFlow: identityReactFlow,
      spaces,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes: updater => {
        nodes = updater(nodes)
      },
      setSelectedNodeIds: selectedNodeIdsState.set,
      setSelectedSpaceIds: selectedSpaceIdsState.set,
    })

    expect(nodes.find(node => node.id === 'node-in')?.selected).toBe(false)
    expect(nodes.find(node => node.id === 'node-out')?.selected).toBe(true)
    expect(selectedNodeIdsRef.current).toEqual(['node-out'])
    expect(selectedNodeIdsState.value).toEqual(['node-out'])
  })
})
