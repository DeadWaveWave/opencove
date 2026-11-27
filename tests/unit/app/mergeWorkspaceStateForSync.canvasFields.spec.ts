import { describe, expect, it } from 'vitest'
import { toShellWorkspaceStateForSync } from '../../../src/app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import type {
  PersistedWorkspaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

// S7, PR 3 (Invariant 1): the document holds no canvas-only field, so the merge of a Worker sync
// snapshot has nothing to carry. An incoming node takes no `selected`, `dragHandle` or `dragging`
// from the node in memory, and an in-memory node never holds its position against the snapshot.
// On the base the merge kept every local position of a workspace while a node was marked
// `dragging: true`. S6 moved drag frames to the overlay, but a select or remove batch that arrived
// in the middle of a drag was a release whose entries still stored `dragging: true`, so a Worker sync
// before React Flow's own release kept the workspace's positions. The release now writes positions
// only and a write that carries the flag throws in development, so the branch is removed on purpose:
// that sync applies other clients' moves.

const persisted = (title: string, x = 0): PersistedWorkspaceState =>
  ({
    id: 'workspace-1',
    name: 'Workspace',
    path: '/repo',
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    nodes: [
      {
        id: 'note-1',
        title,
        position: { x, y: 0 },
        width: 320,
        height: 200,
        kind: 'note',
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        task: null,
        agent: null,
        note: { text: 'text' },
      },
    ],
  }) as unknown as PersistedWorkspaceState

/** The in-memory workspace with canvas-only fields on its node, as a pre-S7 document held them. */
function existingWithCanvasFields(
  fields: Record<string, unknown>,
  position?: { x: number; y: number },
): WorkspaceState {
  const initial = toShellWorkspaceStateForSync(persisted('before'), undefined)
  return {
    ...initial,
    nodes: initial.nodes.map(node => ({ ...node, ...fields, ...(position ? { position } : {}) })),
  }
}

describe('worker sync merge and the canvas-only fields', () => {
  it.each([
    { name: 'selected', fields: { selected: true } },
    { name: 'dragHandle', fields: { dragHandle: '.drag-handle' } },
    { name: 'dragging after a release', fields: { dragging: false } },
    { name: 'dragging', fields: { dragging: true } },
  ])('takes no $name from the node in memory', ({ fields }) => {
    const existing = existingWithCanvasFields(fields)

    const merged = toShellWorkspaceStateForSync(persisted('after'), existing)

    const [node] = merged.nodes
    expect(node.data.title).toBe('after')
    expect(node.selected).toBeUndefined()
    expect(node.dragHandle).toBeUndefined()
    expect(node.dragging).toBeUndefined()
  })

  it('takes the position of the snapshot, also from a node that was marked as dragging', () => {
    const existing = existingWithCanvasFields({ dragging: true }, { x: 500, y: 500 })

    const merged = toShellWorkspaceStateForSync(persisted('before', 40), existing)

    expect(merged.nodes[0].position).toEqual({ x: 40, y: 0 })
  })

  it('does not hold the position of another window while one is marked as dragging', () => {
    const initial = toShellWorkspaceStateForSync(persisted('before'), undefined)
    const dragged = { ...initial.nodes[0], id: 'note-2', dragging: true }
    const existing = { ...initial, nodes: [...initial.nodes, dragged] }

    const merged = toShellWorkspaceStateForSync(persisted('before', 40), existing)

    expect(merged.nodes.find(node => node.id === 'note-1')?.position).toEqual({ x: 40, y: 0 })
  })

  it('keeps the node it holds when the snapshot says nothing new', () => {
    const initial = toShellWorkspaceStateForSync(persisted('same'), undefined)

    const merged = toShellWorkspaceStateForSync(persisted('same'), initial)

    expect(merged).toBe(initial)
    expect(merged.nodes[0]).toBe(initial.nodes[0])
  })
})
