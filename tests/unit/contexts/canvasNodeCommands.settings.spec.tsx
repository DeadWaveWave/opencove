import { act } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { resolveDefaultTaskWindowSize } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { useWorkspaceCanvasArrange } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useArrange'
import { useWorkspaceCanvasNoteToTaskConversion } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNoteToTaskConversion'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasNodeStoreContext,
} from '../../support/canvasDocumentHarness'
import { createRowNodes, createSpace } from '../../support/canvasSelectionFixtures'

// S7 of #647 (review of PR 4): the menu actions and note.convertToTask read the settings
// when they run (Decision 2), not when the hook rendered. Each changes the settings the reader
// returns after the render and calls the same callback again.

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let current: AgentSettings = { ...DEFAULT_AGENT_SETTINGS }
const readAgentSettings = () => current

const sized = (nodes: Node<TerminalNodeData>[]) =>
  nodes.map(node => ({ ...node, initialWidth: node.data.width, initialHeight: node.data.height }))

describe('settings read when a menu action or a note command runs', () => {
  it('converts a note to a task of the size of the bucket at the call', () => {
    current = { ...DEFAULT_AGENT_SETTINGS, standardWindowSizeBucket: 'regular' }
    const harness = createCanvasDocumentHarness({ nodes: sized(createRowNodes(['a', 'b'])) })
    const view = renderCanvasNodeStore(harness, {
      extend: function useConversion({ nodes }: CanvasNodeStoreContext) {
        return useWorkspaceCanvasNoteToTaskConversion({
          selectedNodeIds: [],
          flowNodes: nodes,
          readAgentSettings,
        })
      },
    })
    current = { ...current, standardWindowSizeBucket: 'large' }

    act(() => {
      view.result.current.convertNoteToTask('b')
    })

    const task = harness.readStoreDocument().nodes.find(node => node.id === 'b')!
    expect(task.data.kind).toBe('task')
    expect({ width: task.data.width, height: task.data.height }).toEqual(
      resolveDefaultTaskWindowSize('large'),
    )
    expect(resolveDefaultTaskWindowSize('large')).not.toEqual(
      resolveDefaultTaskWindowSize('regular'),
    )
  })

  it('arranges with the window size bucket of the settings at the call', () => {
    current = { ...DEFAULT_AGENT_SETTINGS, standardWindowSizeBucket: 'regular' }
    const reactFlow = { setViewport: vi.fn(), fitView: vi.fn() } as unknown as ReactFlowInstance<
      Node<TerminalNodeData>,
      Edge
    >
    const nodes = sized(
      createRowNodes(['a', 'b']).map((node, index) => ({
        ...node,
        position: { x: index * 37, y: index * 11 },
      })),
    )
    const run = (bucket: AgentSettings['standardWindowSizeBucket']) => {
      const harness = createCanvasDocumentHarness({ nodes })
      const view = renderCanvasNodeStore(harness, {
        extend: function useArrangeUnderTest() {
          return useWorkspaceCanvasArrange({ reactFlow, readAgentSettings })
        },
      })
      current = { ...current, standardWindowSizeBucket: bucket }
      act(() => view.result.current.arrangeAll())
      const widths = harness.readStoreDocument().nodes.map(node => node.data.width)
      view.unmount()
      current = { ...current, standardWindowSizeBucket: 'regular' }
      return widths
    }

    expect(run('large')).not.toEqual(run('regular'))
  })

  it('focuses an arranged Space with the target zoom of the settings at the call', async () => {
    current = { ...DEFAULT_AGENT_SETTINGS, focusNodeTargetZoom: 1 }
    const setViewport = vi.fn()
    const reactFlow = { setViewport, fitView: vi.fn() } as unknown as ReactFlowInstance<
      Node<TerminalNodeData>,
      Edge
    >
    const nodes = sized(
      createRowNodes(['a', 'b']).map((node, index) => ({
        ...node,
        position: { x: index * 37, y: index * 11 },
      })),
    )
    const harness = createCanvasDocumentHarness({
      nodes,
      spaces: [createSpace('room', { x: -40, y: -40, width: 900, height: 360 }, ['a', 'b'])],
    })
    const view = renderCanvasNodeStore(harness, {
      extend: function useArrangeUnderTest() {
        return useWorkspaceCanvasArrange({ reactFlow, readAgentSettings })
      },
    })
    current = { ...current, focusNodeTargetZoom: 0.6 }

    act(() => view.result.current.arrangeInSpace('room'))
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    })

    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(setViewport.mock.calls[0]![0].zoom).toBeCloseTo(0.6, 5)
  })
})
