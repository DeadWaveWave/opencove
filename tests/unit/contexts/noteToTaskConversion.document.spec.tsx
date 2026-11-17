import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { useWorkspaceCanvasNoteToTaskConversion } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNoteToTaskConversion'
import { useCanvasSelectionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { replaceWorkspaceNodes } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
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

// The conversion of a note to a task is one store write of the node and of the Space that grows to
// hold it, with one flush after it, computed from the document when it runs (#702, PR 9).

const onShowMessage = vi.fn()

function useConversion({ nodes, nodeStore }: CanvasNodeStoreContext) {
  return {
    selection: useCanvasSelectionCommands(),
    conversion: useWorkspaceCanvasNoteToTaskConversion({
      selectedNodeIds: [],
      flowNodes: nodes,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
      onShowMessage,
      standardWindowSizeBucket: 'regular',
    }),
  }
}

// The nodes carry the initial size that the node store would otherwise add with its first write.
function sizedNotes(ids: string[]): Node<TerminalNodeData>[] {
  return createRowNodes(ids).map(node => ({
    ...node,
    initialWidth: node.data.width,
    initialHeight: node.data.height,
  }))
}

// The Space holds the note exactly, so the larger task window makes it grow.
const tightSpace = () => createSpace('space-a', { x: -20, y: -20, width: 340, height: 240 }, ['a'])

function setup(nodes = sizedNotes(['a', 'b'])) {
  const harness = createCanvasDocumentHarness({ nodes, spaces: [tightSpace()] })
  const view = renderCanvasNodeStore(harness, { extend: useConversion })
  harness.notifications.mockClear()
  return {
    harness,
    view,
    convert: (id: string) => view.result.current.conversion.convertNoteToTask(id),
  }
}

const layoutSyncs = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
})

afterEach(() => {
  window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, layoutSyncs)
})

describe('note to task conversion as one store write', () => {
  it('writes the task and the grown Space in one notification and flushes once', () => {
    const { harness, convert } = setup()
    const before = harness.readStoreDocument()
    let converted = false
    let kindAtFlush: string | null = null
    harness.flush.mockImplementation(() => {
      kindAtFlush = harness.readStoreDocument().nodes[0].data.kind
    })

    act(() => {
      converted = convert('a')
    })

    const after = harness.readStoreDocument()
    // The flush follows the write.
    expect(kindAtFlush).toBe('task')
    expect(converted).toBe(true)
    expect(after.nodes[0].data.kind).toBe('task')
    expect(after.nodes[0].data.note).toBeNull()
    // The bystander keeps its runtime data; the Space that grew may push it.
    expect(after.nodes[1].data).toBe(before.nodes[1].data)
    expect(after.spaces[0].rect!.width).toBeGreaterThan(before.spaces[0].rect!.width)
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledTimes(1)
    expect(onShowMessage).not.toHaveBeenCalled()
    // Unlike the arrange writes, a conversion asks the terminals to re-fit.
    expect(layoutSyncs).toHaveBeenCalledTimes(1)
  })

  it('converts a note that another writer stored earlier in the same call', () => {
    const { harness, convert } = setup([])
    let converted = false

    act(() => {
      replaceWorkspaceNodes(harness.workspaceId, sizedNotes(['late']))
      converted = convert('late')
    })

    expect(converted).toBe(true)
    expect(harness.readStoreDocument().nodes[0].data.kind).toBe('task')
  })

  it('keeps the canvas selection flag of the converted note', () => {
    const { harness, view, convert } = setup()
    act(() => view.result.current.selection.setNodeIds(['a']))
    expect(harness.readStoreDocument().nodes[0].selected).toBeFalsy()
    expect(view.result.current.nodeStore.nodesRef.current[0].selected).toBe(true)

    act(() => {
      convert('a')
    })

    expect(harness.readStoreDocument().nodes[0].selected).toBe(true)
  })

  it.each([
    ['an empty id', ' '],
    ['an id that names no window', 'ghost'],
  ])('writes nothing, flushes nothing and says nothing for %s', (_name, id) => {
    const { harness, convert } = setup()
    let converted = true

    act(() => {
      converted = convert(id)
    })

    expect(converted).toBe(false)
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(onShowMessage).not.toHaveBeenCalled()
    expect(layoutSyncs).not.toHaveBeenCalled()
  })

  it('writes nothing and flushes nothing for a window that is not a note', () => {
    const [note] = sizedNotes(['t'])
    const terminal = { ...note, data: { ...note.data, kind: 'terminal' as const, note: null } }
    const { harness, convert } = setup([terminal])
    let converted = true

    act(() => {
      converted = convert('t')
    })

    expect(converted).toBe(false)
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
    expect(onShowMessage).not.toHaveBeenCalled()
  })

  it('warns and writes nothing for an empty note', () => {
    const [note] = sizedNotes(['a'])
    const { harness, convert } = setup([{ ...note, data: { ...note.data, note: { text: '  ' } } }])
    let converted = true

    act(() => {
      converted = convert('a')
    })

    expect(converted).toBe(false)
    expect(onShowMessage).toHaveBeenCalledExactlyOnceWith(
      'messages.noteToTaskRequiresContent',
      'warning',
    )
    expect(harness.notifications).not.toHaveBeenCalled()
    expect(harness.flush).not.toHaveBeenCalled()
  })

  it('warns and writes nothing for a note that another writer emptied in the same call', () => {
    const { harness, convert } = setup()
    let converted = true

    act(() => {
      replaceWorkspaceNodes(
        harness.workspaceId,
        harness
          .readStoreDocument()
          .nodes.map(node =>
            node.id === 'a' ? { ...node, data: { ...node.data, note: { text: '' } } } : node,
          ),
      )
      converted = convert('a')
    })

    expect(converted).toBe(false)
    expect(onShowMessage).toHaveBeenCalledExactlyOnceWith(
      'messages.noteToTaskRequiresContent',
      'warning',
    )
    // The replace is the only write, and nothing flushed.
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(harness.flush).not.toHaveBeenCalled()
    expect(harness.readStoreDocument().nodes[0].data.kind).toBe('note')
  })
})
