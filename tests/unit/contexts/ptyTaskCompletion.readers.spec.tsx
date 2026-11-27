import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionSummary,
  TerminalSessionMetadataEvent,
} from '../../../src/shared/contracts/dto'
import {
  createPtyEventHub,
  type PtyEventHub,
} from '../../../src/app/renderer/shell/utils/ptyEventHub'
import { useWorkspaceCanvasPtyTaskCompletion } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/usePtyTaskCompletion'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'

import {
  agentNode,
  nodeOf,
  renderInTwoWorkspaces,
  WORKSPACE_A as A,
  WORKSPACE_B as B,
} from '../../support/agentRuntimeHarness'
import { setDocumentNodes } from '../../support/documentNodes'

// The PTY task completion reads the observed node from the store when an event arrives, and when
// a title scan finishes (#702, PR 10): a node the store holds before the canvas view catches up is
// observed, and a node that the store no longer holds as the scan found it is left alone. The
// subscription belongs to the workspace of the render that made it.

const shared = vi.hoisted(() => ({ hub: null as PtyEventHub | null }))
vi.mock('../../../src/app/renderer/shell/utils/ptyEventHub', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/app/renderer/shell/utils/ptyEventHub')>()),
  getPtyEventHub: () => shared.hub!,
}))

const firstRender = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext',
  async importOriginal => {
    const original = await importOriginal<Record<string, () => unknown>>()
    const stable = (name: string) => () => {
      const real = original[name]()
      if (!firstRender.values.has(name)) {
        firstRender.values.set(name, real)
      }
      return firstRender.values.get(name)
    }
    return {
      ...original,
      useCanvasUiCommands: stable('useCanvasUiCommands'),
      useCanvasSelectionCommands: stable('useCanvasSelectionCommands'),
      useCanvasDocumentCommands: stable('useCanvasDocumentCommands'),
      useReadCanvasUi: stable('useReadCanvasUi'),
      useReadCanvasSelection: stable('useReadCanvasSelection'),
    }
  },
)

let emitMetadata!: (event: TerminalSessionMetadataEvent) => void

const summaryOf = (sessionId: string, title: string): AgentSessionSummary => ({
  sessionId,
  provider: 'codex',
  cwd: '/project',
  title,
  preview: null,
  startedAt: null,
  updatedAt: null,
  source: 'codex-file',
})

// A node that the title sync targets: a direct agent launch that still shows its placeholder.
const watched = (id: string) =>
  agentNode(id, { sessionId: `${id}-runtime` }, { resumeSessionId: `${id}-resume` })

const metadataOf = (id: string): TerminalSessionMetadataEvent => ({
  sessionId: `${id}-runtime`,
  resumeSessionId: `${id}-resume`,
})

beforeEach(() => {
  firstRender.values.clear()
  shared.hub = createPtyEventHub({
    onData: () => () => undefined,
    onExit: () => () => undefined,
    onState: () => () => undefined,
    onMetadata: listener => {
      emitMetadata = listener
      return () => undefined
    },
  })
  shared.hub.onMetadata(() => undefined)
})

afterEach(() => {
  shared.hub?.dispose()
  shared.hub = null
})

describe('the PTY task completion in two workspaces', () => {
  function renderCompletion(
    documents: Parameters<typeof renderInTwoWorkspaces>[1],
    query: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>,
    onWrite?: () => void,
  ) {
    // `workspaceId` is optional for the hook and left out here: only the document reader can then
    // move the subscription to the workspace shown.
    return renderInTwoWorkspaces(({ canvasState, nodeStore }) => {
      useWorkspaceCanvasPtyTaskCompletion({
        nodes: canvasState.flowNodes,
        setNodes: (updater, options) => {
          onWrite?.()
          nodeStore.setNodes(updater, options)
        },
        listAgentSessions: query,
      })
    }, documents)
  }

  it('starts the title sync of a node the store gained in the same call as the event', async () => {
    const query = vi.fn(async () => [summaryOf('agent-a-resume', 'Review persistence')])
    renderCompletion({}, query)

    await act(async () => {
      setDocumentNodes(A, [watched('agent-a')])
      emitMetadata(metadataOf('agent-a'))
    })

    expect(query).toHaveBeenCalledWith('agent-a', 20)
    expect(nodeOf(A, 'agent-a').data.title).toBe('codex · Review persistence')
  })

  it('starts the title sync of the shown workspace after a switch', async () => {
    const query = vi.fn(async (nodeId: string) => [
      summaryOf(`${nodeId}-resume`, `Title of ${nodeId}`),
    ])
    const { showB } = renderCompletion({}, query)
    await act(async () => {
      setDocumentNodes(A, [watched('agent-a')])
      emitMetadata(metadataOf('agent-a'))
    })
    expect(nodeOf(A, 'agent-a').data.title).toBe('codex · Title of agent-a')

    showB()
    await act(async () => {
      setDocumentNodes(B, [watched('agent-b')])
      emitMetadata(metadataOf('agent-b'))
    })

    expect(query).toHaveBeenLastCalledWith('agent-b', 20)
    expect(nodeOf(B, 'agent-b').data.title).toBe('codex · Title of agent-b')
    expect(nodeOf(A, 'agent-a').data.title).toBe('codex · Title of agent-a')
  })

  it('starts the title sync of its own workspace while another is displayed', async () => {
    const query = vi.fn(async () => [summaryOf('agent-a-resume', 'Review persistence')])
    renderCompletion({ a: { nodes: [watched('agent-a')] } }, query)
    act(() => useAppStore.setState({ activeWorkspaceId: B }))

    await act(async () => {
      emitMetadata(metadataOf('agent-a'))
    })

    expect(query).toHaveBeenCalledWith('agent-a', 20)
    expect(nodeOf(A, 'agent-a').data.title).toBe('codex · Review persistence')
  })

  it('ignores an event for a node that only the other workspace holds', async () => {
    const query = vi.fn(async () => [summaryOf('agent-a-resume', 'Review persistence')])
    const { showB } = renderCompletion({ a: { nodes: [watched('agent-a')] } }, query)
    showB()
    query.mockClear()

    await act(async () => {
      emitMetadata(metadataOf('agent-a'))
    })

    expect(query).not.toHaveBeenCalled()
  })

  it('leaves a node alone when the store no longer holds it as the scan found it', async () => {
    let resolve!: (value: AgentSessionSummary[]) => void
    const query = vi.fn(
      () =>
        new Promise<AgentSessionSummary[]>(onResolve => {
          resolve = onResolve
        }),
    )
    const writes = vi.fn()
    renderCompletion({ a: { nodes: [watched('agent-a')] } }, query, writes)
    await act(async () => {
      emitMetadata(metadataOf('agent-a'))
    })
    expect(query).toHaveBeenCalledTimes(1)
    writes.mockClear()

    // The runtime of the node is replaced in the store while the scan runs; the scan re-reads it.
    await act(async () => {
      setDocumentNodes(A, [
        { ...watched('agent-a'), data: { ...watched('agent-a').data, sessionId: 'replacement' } },
      ])
      resolve([summaryOf('agent-a-resume', 'Review persistence')])
    })

    expect(nodeOf(A, 'agent-a').data.title).toBe('codex · default')
    expect(writes).not.toHaveBeenCalled()
  })
})
