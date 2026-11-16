import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as placement from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.resolvePlacement'
import { subscribeWorkspaceNodesClosed } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeClosureEvents'
import type { UseWorkspaceCanvasNodesStoreResult } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.types'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  documentOf,
  nodeOf,
  renderInTwoWorkspaces,
  sized,
  stubOpencoveApi,
  WORKSPACE_A as A,
  type RuntimeCanvasContext,
} from '../../support/agentRuntimeHarness'
import { CREATIONS } from '../../support/nodeStoreCreations'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'
import { pixelNode } from './workspacePixelLayer.fixtures'

// The persistence flushes of the node store and its creators (#702, PR 13): each is requested once,
// after the write it follows, and as often as before. A flush is counted with the number of store
// writes that came before it and the document it saw, so one that is dropped, doubled or requested
// before its write fails. The store flushes also when a mutation changed nothing, except where the
// base flushed only on a change; those cases are pinned the other way round.

vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => translation }))
const translation = vi.hoisted(() => ({ t: (key: string) => key }))

beforeEach(() => {
  stubOpencoveApi({ pty: { kill: vi.fn(async () => undefined) } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Store = UseWorkspaceCanvasNodesStoreResult

function renderStore(nodes: Node<TerminalNodeData>[]) {
  const rendered = renderInTwoWorkspaces((context: RuntimeCanvasContext) => context, {
    a: { nodes },
  })
  rendered.harness.notifications.mockClear()
  return { ...rendered, store: () => rendered.view.result.current.nodeStore }
}

const terminal = () => sized({ ...pixelNode({ title: 'Terminal' }), id: 'terminal-1' })

const noteNode = () =>
  sized({
    ...pixelNode({ kind: 'note', sessionId: '', title: 'Note', note: { text: 'text' } }),
    id: 'note-1',
    type: 'noteNode',
  })

const roleNode = () =>
  sized({
    ...pixelNode({
      kind: 'role',
      sessionId: '',
      title: 'Role',
      role: {
        roleId: 'role-1',
        roleName: 'Reviewer',
        roleDescription: '',
        promptTemplate: '',
        inputHint: '',
        outputFormat: '',
        input: 'input',
        selectedProvider: 'codex',
        linkedAgentNodeId: null,
        runHistory: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
    id: 'role-1',
    type: 'roleNode',
  })

const websiteNode = () =>
  sized({
    ...pixelNode({
      kind: 'website',
      sessionId: '',
      title: 'Site',
      website: {
        url: 'https://a.example',
        pinned: false,
        sessionMode: 'shared',
        profileId: null,
        browserMode: 'iframe',
      },
    }),
    id: 'website-1',
    type: 'websiteNode',
  })

describe.each(Object.keys(CREATIONS))('creating %s', name => {
  it('flushes once, after the write that adds the node', async () => {
    const { view, harness, flushes } = renderStore([])
    let created: Node<TerminalNodeData> | null = null

    await act(async () => {
      created = (await CREATIONS[name](view.result.current)) as Node<TerminalNodeData>
    })

    expect(created).not.toBeNull()
    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes.map(node => node.id)).toEqual([created!.id])
  })

  it.skipIf(name === 'a note placed to the right')(
    'flushes nothing when no slot is found',
    async () => {
      const { view, harness, flushes } = renderStore([])
      vi.spyOn(placement, 'resolveNodesPlacement').mockReturnValue({
        placement: { x: 0, y: 0 },
        canPlace: false,
      })

      await act(async () => {
        await CREATIONS[name](view.result.current)
      })

      expect(harness.notifications).not.toHaveBeenCalled()
      expect(flushes).toHaveLength(0)
    },
  )
})

describe('closeNode', () => {
  it('flushes once, after the write that removes the node and after it has been announced', async () => {
    const { store, harness, flushes } = renderStore([terminal()])
    const order: string[] = []
    const unsubscribe = subscribeWorkspaceNodesClosed(() => order.push('closed'))
    const flushing = harness.flush.getMockImplementation()
    harness.flush.mockImplementation(() => {
      order.push('flush')
      flushing?.()
    })

    await act(async () => {
      await store().closeNode('terminal-1')
    })
    unsubscribe()

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes).toEqual([])
    expect(order).toEqual(['closed', 'flush'])
  })

  it('flushes once for a node that is not there', async () => {
    const { store, flushes } = renderStore([terminal()])

    await act(async () => {
      await store().closeNode('missing')
    })

    expect(flushes).toHaveLength(1)
  })
})

describe('resizeNode', () => {
  it('flushes once, after the write that resizes the node', () => {
    const { store, harness, flushes } = renderStore([terminal()])

    act(() => {
      store().resizeNode('terminal-1', {
        position: { x: 100, y: 80 },
        size: { width: 640, height: 480 },
      })
    })

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes[0].data.width).toBe(640)
  })

  it('flushes nothing for a node that is not there', () => {
    const { store, harness, flushes } = renderStore([terminal()])

    act(() => {
      store().resizeNode('missing', { position: { x: 0, y: 0 }, size: { width: 640, height: 480 } })
    })

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
  })
})

interface Mutation {
  name: string
  nodes: () => Node<TerminalNodeData>[]
  /** Changes the node. */
  change: (store: Store) => void
  /** The change that the document must hold when the flush runs. */
  changed: (node: Node<TerminalNodeData>) => boolean
  /** Whether the same change a second time leaves the document as it is. */
  idempotent: boolean
  /** Whether the base flushed when nothing changed. */
  flushesWithoutChange: boolean
  /** Addresses a node that is not there. */
  missing: (store: Store) => void
}

const frame = { position: { x: 5, y: 6 }, size: { width: 700, height: 500 } }

const MUTATIONS: Mutation[] = [
  {
    name: 'renameTerminalTitle',
    idempotent: true,
    nodes: () => [terminal()],
    change: store => store.renameTerminalTitle('terminal-1', 'Renamed'),
    changed: node => node.data.title === 'Renamed' && node.data.titlePinnedByUser === true,
    flushesWithoutChange: true,
    missing: store => store.renameTerminalTitle('missing', 'Renamed'),
  },
  {
    name: 'setNodeLabelColorOverride',
    idempotent: true,
    nodes: () => [terminal()],
    change: store => store.setNodeLabelColorOverride(['terminal-1'], 'blue'),
    changed: node => node.data.labelColorOverride === 'blue',
    flushesWithoutChange: true,
    missing: store => store.setNodeLabelColorOverride(['missing'], 'blue'),
  },
  {
    name: 'renameNoteTitle',
    idempotent: true,
    nodes: () => [noteNode()],
    change: store => store.renameNoteTitle('note-1', 'Renamed'),
    changed: node => node.data.title === 'Renamed',
    flushesWithoutChange: false,
    missing: store => store.renameNoteTitle('missing', 'Renamed'),
  },
  {
    name: 'updateRoleProvider',
    idempotent: true,
    nodes: () => [roleNode()],
    change: store => store.updateRoleProvider('role-1', 'claude-code'),
    changed: node => node.data.role?.selectedProvider === 'claude-code',
    flushesWithoutChange: true,
    missing: store => store.updateRoleProvider('missing', 'codex'),
  },
  {
    name: 'updateRoleInput',
    idempotent: true,
    nodes: () => [roleNode()],
    change: store => store.updateRoleInput('role-1', 'new input'),
    changed: node => node.data.role?.input === 'new input',
    flushesWithoutChange: true,
    missing: store => store.updateRoleInput('missing', 'new input'),
  },
  {
    name: 'appendRoleRunRecord',
    idempotent: false,
    nodes: () => [roleNode()],
    change: store =>
      store.appendRoleRunRecord('role-1', {
        linkedAgentNodeId: 'agent-1',
        record: { id: 'run-1' } as never,
      }),
    changed: node => node.data.role?.runHistory.length === 1,
    flushesWithoutChange: true,
    missing: store =>
      store.appendRoleRunRecord('missing', { linkedAgentNodeId: null, record: {} as never }),
  },
  {
    name: 'updateWebsiteUrl',
    idempotent: true,
    nodes: () => [websiteNode()],
    change: store => store.updateWebsiteUrl('website-1', 'https://b.example'),
    changed: node => node.data.website?.url === 'https://b.example',
    flushesWithoutChange: true,
    missing: store => store.updateWebsiteUrl('missing', 'https://b.example'),
  },
  {
    name: 'setWebsitePinned',
    idempotent: true,
    nodes: () => [websiteNode()],
    change: store => store.setWebsitePinned('website-1', true),
    changed: node => node.data.website?.pinned === true,
    flushesWithoutChange: true,
    missing: store => store.setWebsitePinned('missing', true),
  },
  {
    name: 'setWebsiteSession',
    idempotent: true,
    nodes: () => [websiteNode()],
    change: store => store.setWebsiteSession('website-1', 'incognito', null),
    changed: node => node.data.website?.sessionMode === 'incognito',
    flushesWithoutChange: true,
    missing: store => store.setWebsiteSession('missing', 'incognito', null),
  },
  {
    name: 'setWebsiteMode',
    idempotent: true,
    nodes: () => [websiteNode()],
    change: store => store.setWebsiteMode('website-1', 'native'),
    changed: node => node.data.website?.browserMode === 'native',
    flushesWithoutChange: true,
    missing: store => store.setWebsiteMode('missing', 'native'),
  },
  {
    name: 'setWebsiteFullscreen',
    idempotent: false,
    nodes: () => [websiteNode()],
    change: store => store.setWebsiteFullscreen('website-1', frame, null, true),
    changed: node => node.data.website?.isFullscreen === true && node.data.width === 700,
    flushesWithoutChange: true,
    missing: store => store.setWebsiteFullscreen('missing', frame, null, true),
  },
]

describe.each(MUTATIONS)('$name', mutation => {
  it('flushes once, after the write that changes the node', () => {
    const { store, harness, flushes } = renderStore(mutation.nodes())

    act(() => mutation.change(store()))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(flushes).toHaveLength(1)
    expect(flushes[0].notificationsBefore).toBe(1)
    expect(flushes[0].document.nodes.some(mutation.changed)).toBe(true)
  })

  it.skipIf(!mutation.idempotent)(
    mutation.flushesWithoutChange
      ? 'flushes once without a write when the change repeats'
      : 'flushes nothing when the change repeats',
    () => {
      const { store, harness, flushes, view } = renderStore(mutation.nodes())
      act(() => mutation.change(store()))
      harness.notifications.mockClear()
      flushes.length = 0

      act(() => mutation.change(view.result.current.nodeStore))

      expect(harness.notifications).not.toHaveBeenCalled()
      expect(flushes).toHaveLength(mutation.flushesWithoutChange ? 1 : 0)
      if (mutation.flushesWithoutChange) {
        expect(flushes[0].notificationsBefore).toBe(0)
      }
    },
  )

  it(
    mutation.flushesWithoutChange
      ? 'flushes once without a write for a node that is not there'
      : 'flushes nothing for a node that is not there',
    () => {
      const { store, harness, flushes } = renderStore(mutation.nodes())

      act(() => mutation.missing(store()))

      expect(harness.notifications).not.toHaveBeenCalled()
      expect(flushes).toHaveLength(mutation.flushesWithoutChange ? 1 : 0)
    },
  )
})

describe('setWebsiteFullscreen', () => {
  // The call keeps the default layout sync (the other website mutations opt out of it), because
  // the window changes its frame and the terminals around it re-fit.
  it('syncs the terminal layout after the write', () => {
    const { store } = renderStore([websiteNode()])
    const synced = vi.fn()
    window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, synced)

    try {
      act(() => store().setWebsiteFullscreen('website-1', frame, null, true))
    } finally {
      window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, synced)
    }

    expect(synced).toHaveBeenCalledTimes(1)
  })
})

describe('the mutations that do not flush', () => {
  it('updateNoteText writes the text and flushes nothing', () => {
    const { store, harness, flushes } = renderStore([noteNode()])

    act(() => store().updateNoteText('note-1', 'edited'))

    expect(harness.notifications).toHaveBeenCalledTimes(1)
    expect(nodeOf(A, 'note-1').data.note?.text).toBe('edited')
    expect(flushes).toHaveLength(0)
  })
})

describe('the calls that name nothing', () => {
  it('setNodeLabelColorOverride flushes nothing without a node id', () => {
    const { store, harness, flushes } = renderStore([terminal()])

    act(() => store().setNodeLabelColorOverride(['  '], 'blue'))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
    expect(documentOf(A).nodes).toHaveLength(1)
  })

  it.each([
    ['renameNoteTitle', (store: Store) => store.renameNoteTitle('  ', 'x')],
    ['updateNoteText', (store: Store) => store.updateNoteText('  ', 'x')],
    ['updateWebsiteUrl', (store: Store) => store.updateWebsiteUrl('  ', 'x')],
    ['setWebsitePinned', (store: Store) => store.setWebsitePinned('  ', true)],
    ['setWebsiteSession', (store: Store) => store.setWebsiteSession('  ', 'shared', null)],
    ['setWebsiteMode', (store: Store) => store.setWebsiteMode('  ', 'native')],
    ['setWebsiteFullscreen', (store: Store) => store.setWebsiteFullscreen('  ', frame, null, true)],
  ])('%s flushes nothing for a blank node id', (_name, call) => {
    const { store, harness, flushes } = renderStore([noteNode(), websiteNode()])

    act(() => call(store()))

    expect(harness.notifications).not.toHaveBeenCalled()
    expect(flushes).toHaveLength(0)
  })
})
