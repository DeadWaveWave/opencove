import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  Point,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import type { CreateNodeInput } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import type {
  CreateNoteNodeOptions,
  UseWorkspaceCanvasNodesStoreResult,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'
import { useWorkspaceCanvasNodeCreation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.createNodes'
import { createArrangeItemsForCanvasRootNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange.ordering'

interface HarnessApi {
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  createNoteNode: (anchor: Point, options?: CreateNoteNodeOptions) => Node<TerminalNodeData> | null
}

function makeNoteNode({
  id,
  position,
  startedAt,
}: {
  id: string
  position: Point
  startedAt: string | null
}): Node<TerminalNodeData> {
  return {
    id,
    type: 'noteNode',
    position,
    data: {
      sessionId: '',
      title: id,
      width: 320,
      height: 200,
      kind: 'note',
      status: null,
      startedAt,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: {
        text: '',
      },
    },
  }
}

function renderHarness(): HarnessApi {
  const Harness = forwardRef<HarnessApi>(function Harness(_props, ref): React.JSX.Element {
    const nodesRef = useRef<Node<TerminalNodeData>[]>([])
    const spacesRef = useRef<WorkspaceSpaceState[]>([])
    const [, setNodesState] = useState<Node<TerminalNodeData>[]>([])

    const setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes'] = updater => {
      const next = updater(nodesRef.current)
      nodesRef.current = next
      setNodesState(next)
    }

    const { createNodeForSession, createNoteNode } = useWorkspaceCanvasNodeCreation({
      defaultTerminalWindowScalePercent: 100,
      nodesRef,
      spacesRef,
      setNodes,
    })

    useImperativeHandle(
      ref,
      () => ({
        createNodeForSession,
        createNoteNode,
      }),
      [createNodeForSession, createNoteNode],
    )

    return <div />
  })

  const ref = React.createRef<HarnessApi>()
  render(<Harness ref={ref} />)

  if (!ref.current) {
    throw new Error('Harness did not initialize')
  }

  return ref.current
}

describe('Workspace canvas node creation timestamps', () => {
  it('assigns startedAt for note nodes', () => {
    const api = renderHarness()

    let created: Node<TerminalNodeData> | null = null
    act(() => {
      created = api.createNoteNode({ x: 0, y: 0 })
    })

    expect(created?.data.kind).toBe('note')
    expect(typeof created?.data.startedAt).toBe('string')
    expect(Number.isFinite(Date.parse(created?.data.startedAt ?? ''))).toBe(true)
  })

  it('assigns startedAt for terminal nodes', async () => {
    const api = renderHarness()

    let created: Node<TerminalNodeData> | null = null
    await act(async () => {
      created = await api.createNodeForSession({
        sessionId: 'session-1',
        title: 'Terminal 1',
        anchor: { x: 0, y: 0 },
        kind: 'terminal',
      } satisfies CreateNodeInput)
    })

    expect(created?.data.kind).toBe('terminal')
    expect(typeof created?.data.startedAt).toBe('string')
    expect(Number.isFinite(Date.parse(created?.data.startedAt ?? ''))).toBe(true)
  })

  it('orders by createdAt even when positions would differ', () => {
    const older = makeNoteNode({
      id: 'older',
      position: { x: 100, y: 0 },
      startedAt: '2026-01-01T00:00:00.000Z',
    })

    const newer = makeNoteNode({
      id: 'newer',
      position: { x: 0, y: 0 },
      startedAt: '2026-01-01T00:00:01.000Z',
    })

    const ordered = createArrangeItemsForCanvasRootNodes({
      nodes: [older, newer],
      spaces: [],
      order: 'createdAt',
    })

    expect(ordered.map(item => item.id)).toEqual(['older', 'newer'])
  })
})
