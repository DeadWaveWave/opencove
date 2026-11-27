import { describe, expect, it, vi } from 'vitest'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import type { SelectionDraftState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type { CanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.selection'
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

// One marquee application is one `select` command: nodes and Spaces are written together.
function createSelectionSpy() {
  const selectCalls: { nodeIds: string[]; spaceIds: string[] }[] = []
  const commands: CanvasSelectionCommands = {
    setNodeIds: vi.fn(),
    setSpaceIds: vi.fn(),
    select: next => {
      selectCalls.push({ nodeIds: [...next.nodeIds], spaceIds: [...next.spaceIds] })
    },
    clear: vi.fn(),
    retain: vi.fn(),
  }

  return {
    commands,
    selectCalls,
    get last() {
      return selectCalls.at(-1)
    },
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
    const nodes = [
      createNode('node-a', { x: 20, y: 20, selected: true }),
      createNode('node-b', { x: 160, y: 20, selected: false }),
    ]
    const selection = createSelectionSpy()

    applySelectionDraft({
      draft: createDraft({
        toggleSelection: true,
        selectedNodeIdsAtStart: ['node-a'],
      }),
      reactFlow: identityReactFlow,
      spaces: [],
      selection: selection.commands,
      nodes,
    })

    expect(selection.selectCalls).toEqual([{ nodeIds: ['node-b'], spaceIds: [] }])
    expect(selection.commands.setNodeIds).not.toHaveBeenCalled()
    expect(selection.commands.setSpaceIds).not.toHaveBeenCalled()
  })

  it('toggles intersecting spaces during shift marquee selection', () => {
    const selection = createSelectionSpy()
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
      selection: selection.commands,
      nodes: [],
    })

    expect(selection.selectCalls).toEqual([{ nodeIds: [], spaceIds: [] }])
  })

  it('drops out-of-scope selected nodes during shift marquee selection inside a space', () => {
    const nodes = [
      createNode('node-in', { x: 40, y: 40, selected: false }),
      createNode('node-out', { x: 420, y: 40, selected: true }),
    ]
    const selection = createSelectionSpy()
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
      selection: selection.commands,
      nodes,
    })

    expect(selection.selectCalls).toEqual([{ nodeIds: ['node-in'], spaceIds: [] }])
  })

  it('resolves inside-space scope from current spaces when the draft start scope is stale', () => {
    const nodes = [
      createNode('node-in', { x: 40, y: 40, selected: false }),
      createNode('node-out', { x: 420, y: 40, selected: false }),
    ]
    const selection = createSelectionSpy()
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
        startX: 20,
        startY: 20,
        currentX: 560,
        currentY: 160,
        startSpaceId: null,
      }),
      reactFlow: identityReactFlow,
      spaces,
      selection: selection.commands,
      nodes,
    })

    expect(selection.selectCalls).toEqual([{ nodeIds: ['node-in'], spaceIds: [] }])
  })

  it('drops out-of-scope selected nodes during shift marquee selection outside spaces', () => {
    const nodes = [
      createNode('node-in', { x: 40, y: 40, selected: true }),
      createNode('node-out', { x: 420, y: 40, selected: false }),
    ]
    const selection = createSelectionSpy()
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
      selection: selection.commands,
      nodes,
    })

    expect(selection.selectCalls).toEqual([{ nodeIds: ['node-out'], spaceIds: [] }])
  })
})
