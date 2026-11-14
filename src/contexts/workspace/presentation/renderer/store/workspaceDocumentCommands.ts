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
  setState(partial: Pick<WorkspaceDocumentStoreState, 'workspaces'>): void
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
