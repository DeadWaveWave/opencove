import type { Node } from '@xyflow/react'
import type {
  SpaceArchiveRecord,
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceState,
  WorkspaceViewport,
} from '../types'
import { appendSpaceArchiveRecord } from '../utils/spaceArchiveRecords'
import {
  applyWorkspaceDocument,
  toWorkspaceDocument,
  type WorkspaceDocument,
} from './workspaceDocument'

// The app store lives in the shell, which this layer may not import. The shell binds itself here
// right after creating the store, so the module is the single writer of document fields.
export interface WorkspaceDocumentStoreState {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string | null
}

export interface WorkspaceDocumentStore {
  getState(): WorkspaceDocumentStoreState
  setState(
    partial: Pick<WorkspaceDocumentStoreState, 'workspaces'> | WorkspaceDocumentStoreState,
  ): void
}

export type WorkspaceDocumentRecipe = (document: Readonly<WorkspaceDocument>) => WorkspaceDocument

export type WorkspaceDocumentCommandResult =
  | { status: 'missing' }
  | { status: 'unchanged'; document: WorkspaceDocument }
  | { status: 'applied'; document: WorkspaceDocument }

let boundStore: WorkspaceDocumentStore | null = null
let persistFlush: (() => void) | null = null
let isRecipeRunning = false

export function bindWorkspaceDocumentStore(store: WorkspaceDocumentStore): void {
  boundStore = store
}

export function registerWorkspaceDocumentPersistFlush(flush: () => void): () => void {
  persistFlush = flush
  return () => {
    if (persistFlush === flush) {
      persistFlush = null
    }
  }
}

function requireStore(): WorkspaceDocumentStore {
  if (!boundStore) {
    throw new Error('workspace document store is not bound')
  }
  return boundStore
}

export function isActiveWorkspace(workspaceId: string): boolean {
  return requireStore().getState().activeWorkspaceId === workspaceId
}

/**
 * Applies a recipe to the document of `workspaceId`, computed from the store as it is now.
 * The recipe runs outside the store's `set` and must be pure: a nested command would be
 * overwritten by this write, which is the lost update this module exists to prevent.
 */
export function commitCanvasDocument(
  workspaceId: string,
  recipe: WorkspaceDocumentRecipe,
  options: { flush?: boolean } = {},
): WorkspaceDocumentCommandResult {
  if (isRecipeRunning) {
    throw new Error('workspace document command ran inside a recipe')
  }
  const store = requireStore()
  const state = store.getState()
  const index = state.workspaces.findIndex(candidate => candidate.id === workspaceId)
  if (index < 0) {
    return { status: 'missing' }
  }

  const workspace = state.workspaces[index]
  let result: WorkspaceDocument
  isRecipeRunning = true
  try {
    result = recipe(toWorkspaceDocument(workspace))
  } finally {
    isRecipeRunning = false
  }

  const next = applyWorkspaceDocument(workspace, result)
  if (next === workspace) {
    if (options.flush) {
      persistFlush?.()
    }
    return { status: 'unchanged', document: toWorkspaceDocument(workspace) }
  }

  const workspaces = [...state.workspaces]
  workspaces[index] = next
  store.setState({ workspaces })
  if (options.flush) {
    persistFlush?.()
  }
  return { status: 'applied', document: toWorkspaceDocument(next) }
}

interface RuntimeObservationResult {
  nextWorkspaces: WorkspaceState[]
  didChange: boolean
  durableDidChange: boolean
}

function assertOnlyNodesChanged(
  previous: readonly WorkspaceState[],
  next: readonly WorkspaceState[],
): void {
  next.forEach((workspace, index) => {
    const before = previous[index]
    if (workspace === before) {
      return
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(workspace)])
    for (const key of keys) {
      if (
        key !== 'nodes' &&
        !Object.is(before[key as keyof WorkspaceState], workspace[key as never])
      ) {
        throw new Error(
          `runtime observation changed workspace field "${key}"; only nodes may change`,
        )
      }
    }
  })
}

/**
 * Applies a runtime observation (agent state, exit, metadata, terminal geometry) to every
 * workspace it matches, in one store write, computed from the store as it is now. Observations
 * name a session, not a workspace, so the helper may touch several workspaces. Returns whether
 * anything was written. The flush is requested only for a durable change.
 */
export function applyRuntimeObservation(
  observe: (workspaces: readonly WorkspaceState[]) => RuntimeObservationResult,
): boolean {
  if (isRecipeRunning) {
    throw new Error('workspace document command ran inside a recipe')
  }
  const store = requireStore()
  const { workspaces } = store.getState()
  let result: RuntimeObservationResult
  isRecipeRunning = true
  try {
    result = observe(workspaces)
  } finally {
    isRecipeRunning = false
  }
  if (!result.didChange) {
    return false
  }
  if (import.meta.env.DEV) {
    assertOnlyNodesChanged(workspaces, result.nextWorkspaces)
  }
  store.setState({ workspaces: result.nextWorkspaces })
  if (result.durableDidChange) {
    persistFlush?.()
  }
  return true
}

/**
 * Worker sync replaces the whole list and the active workspace in one write. `next` is computed
 * by the caller from the store in the same synchronous block, so nothing can interleave.
 */
export function replaceFromSync(next: WorkspaceDocumentStoreState): void {
  if (isRecipeRunning) {
    throw new Error('workspace document command ran inside a recipe')
  }
  requireStore().setState({
    workspaces: next.workspaces,
    activeWorkspaceId: next.activeWorkspaceId,
  })
}

/**
 * Startup hydration installs the persisted list, then the active workspace, as two writes in
 * that order: listeners that read both fields see the same intermediate state as before.
 */
export function hydrateWorkspaceList(initial: WorkspaceDocumentStoreState): void {
  if (isRecipeRunning) {
    throw new Error('workspace document command ran inside a recipe')
  }
  const store = requireStore()
  store.setState({ workspaces: initial.workspaces })
  // Same array: this second write changes only the active workspace.
  store.setState({ workspaces: initial.workspaces, activeWorkspaceId: initial.activeWorkspaceId })
}

// Spaces are not reconciled here, so a merge that added or dropped a node would leave them stale.
function assertSameNodeIds(
  previous: readonly Node<TerminalNodeData>[],
  next: readonly Node<TerminalNodeData>[],
): void {
  if (
    previous.length !== next.length ||
    previous.some((node, index) => node.id !== next[index].id)
  ) {
    throw new Error('hydration merges may only change existing nodes')
  }
}

/**
 * Merges hydrated runtime data into the nodes of one workspace, computed from the store as it is
 * now. Hydration never adds or removes nodes, so Spaces are not reconciled: a Space keeps its
 * identity. A recipe that returns the same array writes nothing.
 */
export function mergeHydratedNodes(
  workspaceId: string,
  recipe: (nodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
): WorkspaceDocumentCommandResult {
  if (isRecipeRunning) {
    throw new Error('workspace document command ran inside a recipe')
  }
  const store = requireStore()
  const state = store.getState()
  const index = state.workspaces.findIndex(candidate => candidate.id === workspaceId)
  if (index < 0) {
    return { status: 'missing' }
  }

  const workspace = state.workspaces[index]
  let nodes: Node<TerminalNodeData>[]
  isRecipeRunning = true
  try {
    nodes = recipe(workspace.nodes)
  } finally {
    isRecipeRunning = false
  }
  if (nodes === workspace.nodes) {
    return { status: 'unchanged', document: toWorkspaceDocument(workspace) }
  }
  if (import.meta.env.DEV) {
    assertSameNodeIds(workspace.nodes, nodes)
  }

  const next = { ...workspace, nodes }
  const workspaces = [...state.workspaces]
  workspaces[index] = next
  store.setState({ workspaces })
  return { status: 'applied', document: toWorkspaceDocument(next) }
}

/**
 * Mount repair resolves the Space mounts of several workspaces asynchronously and applies them
 * together in one write, onto the workspaces as the store holds them now. The caller requests the
 * persistence flush afterwards.
 */
export function repairWorkspaceSpaces(
  repairedSpacesByWorkspaceId: ReadonlyMap<string, WorkspaceSpaceState[]>,
): void {
  if (isRecipeRunning) {
    throw new Error('workspace document command ran inside a recipe')
  }
  const store = requireStore()
  let didRepair = false
  const workspaces = store.getState().workspaces.map(workspace => {
    const spaces = repairedSpacesByWorkspaceId.get(workspace.id)
    if (!spaces) {
      return workspace
    }
    didRepair = true
    return { ...workspace, spaces }
  })
  if (didRepair) {
    store.setState({ workspaces })
  }
}

export function replaceWorkspaceNodes(
  workspaceId: string,
  nodes: Node<TerminalNodeData>[],
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(workspaceId, document => ({ ...document, nodes }))
}

export function replaceWorkspaceSpaces(
  workspaceId: string,
  spaces: WorkspaceSpaceState[],
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(workspaceId, document => ({ ...document, spaces }))
}

export function setWorkspaceViewport(
  workspaceId: string,
  viewport: WorkspaceViewport,
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(workspaceId, document => ({
    ...document,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  }))
}

export function setWorkspaceMinimapVisible(
  workspaceId: string,
  isVisible: boolean,
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(workspaceId, document => ({
    ...document,
    isMinimapVisible: isVisible,
  }))
}

export function setWorkspaceActiveSpace(
  workspaceId: string,
  spaceId: string | null,
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(workspaceId, document => {
    const hasTargetSpace =
      spaceId !== null &&
      document.spaces.some(space => space.id === spaceId && !space.parentSpaceId)
    return { ...document, activeSpaceId: hasTargetSpace ? spaceId : null }
  })
}

export function appendWorkspaceSpaceArchiveRecord(
  workspaceId: string,
  record: SpaceArchiveRecord,
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(
    workspaceId,
    document => ({
      ...document,
      spaceArchiveRecords: appendSpaceArchiveRecord(document.spaceArchiveRecords, record),
    }),
    { flush: true },
  )
}

export function removeWorkspaceSpaceArchiveRecord(
  workspaceId: string,
  recordId: string,
): WorkspaceDocumentCommandResult {
  return commitCanvasDocument(
    workspaceId,
    document => {
      const records = Array.isArray(document.spaceArchiveRecords)
        ? document.spaceArchiveRecords
        : []
      const nextRecords = records.filter(record => record.id !== recordId)
      return nextRecords.length === records.length
        ? document
        : { ...document, spaceArchiveRecords: nextRecords }
    },
    { flush: true },
  )
}
