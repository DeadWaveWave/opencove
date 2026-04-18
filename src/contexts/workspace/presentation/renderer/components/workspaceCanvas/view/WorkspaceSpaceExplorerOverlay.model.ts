import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import { toErrorMessage } from '../helpers'
import { isWithinRootUri, sortEntries } from './WorkspaceSpaceExplorerOverlay.helpers'
import { useSpaceExplorerOverlayActions } from './WorkspaceSpaceExplorerOverlay.actions'
import { useSpaceExplorerOverlayMutations } from './WorkspaceSpaceExplorerOverlay.mutations'
import type { SpaceExplorerClipboardItem } from './WorkspaceSpaceExplorerOverlay.operations'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'

export type SpaceExplorerCreateMode = 'file' | 'directory' | null

export type SpaceExplorerRow =
  | { kind: 'entry'; entry: FileSystemEntry; depth: number; isExpanded: boolean }
  | {
      kind: 'state'
      id: string
      depth: number
      parentDirectoryUri: string
      stateKind: 'loading' | 'error'
      message: string
    }

type DirectoryListing = {
  entries: FileSystemEntry[]
  isLoading: boolean
  error: string | null
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('[contenteditable="true"]') !== null ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  )
}

export function useSpaceExplorerOverlayModel({
  rootUri,
  mountId,
  spaceId,
  explorerClipboard,
  setExplorerClipboard,
  findBlockingOpenDocument,
  onPreviewFile,
  onOpenFile,
  onDismissQuickPreview,
  onShowMessage,
}: {
  rootUri: string
  mountId: string | null
  spaceId: string
  explorerClipboard: SpaceExplorerClipboardItem | null
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  onPreviewFile: (uri: string) => void
  onOpenFile: (uri: string) => void
  onDismissQuickPreview: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}) {
  const { t } = useTranslation()
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [expandedDirectoryUris, setExpandedDirectoryUris] = React.useState<Set<string>>(
    () => new Set(),
  )
  const [selectedEntryUri, setSelectedEntryUri] = React.useState<string | null>(null)
  const [selectedEntryKind, setSelectedEntryKind] = React.useState<FileSystemEntry['kind'] | null>(
    null,
  )
  const [directoryListings, setDirectoryListings] = React.useState<
    Record<string, DirectoryListing>
  >(() => ({}))

  const loadDirectory = React.useCallback(
    async (uri: string): Promise<void> => {
      const api = resolveFilesystemApiForMount(mountId)
      if (!api) {
        setDirectoryListings(previous => ({
          ...previous,
          [uri]: {
            entries: [],
            isLoading: false,
            error: t('documentNode.filesystemUnavailable'),
          },
        }))
        return
      }

      setDirectoryListings(previous => ({
        ...previous,
        [uri]: {
          entries: previous[uri]?.entries ?? [],
          isLoading: true,
          error: null,
        },
      }))

      try {
        const result = await api.readDirectory({ uri })
        setDirectoryListings(previous => ({
          ...previous,
          [uri]: {
            entries: sortEntries(result.entries),
            isLoading: false,
            error: null,
          },
        }))
      } catch (error) {
        setDirectoryListings(previous => ({
          ...previous,
          [uri]: {
            entries: [],
            isLoading: false,
            error: toErrorMessage(error),
          },
        }))
      }
    },
    [mountId, t],
  )

  React.useEffect(() => {
    setExpandedDirectoryUris(new Set())
    setDirectoryListings({})
    setRefreshNonce(previous => previous + 1)
    setSelectedEntryUri(null)
    setSelectedEntryKind(null)
  }, [mountId, rootUri, spaceId])

  React.useEffect(() => {
    void loadDirectory(rootUri)
  }, [loadDirectory, refreshNonce, rootUri])

  React.useEffect(() => {
    expandedDirectoryUris.forEach(uri => {
      if (!isWithinRootUri(rootUri, uri) || directoryListings[uri]) {
        return
      }
      void loadDirectory(uri)
    })
  }, [directoryListings, expandedDirectoryUris, loadDirectory, refreshNonce, rootUri])

  const refresh = React.useCallback(() => {
    setDirectoryListings({})
    setRefreshNonce(previous => previous + 1)
  }, [])

  const rootListing = directoryListings[rootUri] ?? null
  const isLoadingRoot = rootListing === null ? true : rootListing.isLoading
  const rootError = rootListing?.error ?? null

  const rows = React.useMemo<SpaceExplorerRow[]>(() => {
    if (!rootListing || rootListing.isLoading || rootListing.error) {
      return []
    }

    const list: SpaceExplorerRow[] = []
    const walk = (directoryUri: string, depth: number) => {
      const listing = directoryListings[directoryUri]
      if (!listing || listing.isLoading || listing.error) {
        return
      }

      for (const entry of listing.entries) {
        if (!isWithinRootUri(rootUri, entry.uri)) {
          continue
        }

        const isExpanded = entry.kind === 'directory' && expandedDirectoryUris.has(entry.uri)
        list.push({ kind: 'entry', entry, depth, isExpanded })

        if (entry.kind !== 'directory' || !isExpanded) {
          continue
        }

        const childListing = directoryListings[entry.uri]
        if (!childListing || childListing.isLoading) {
          list.push({
            kind: 'state',
            id: `${entry.uri}:loading`,
            depth: depth + 1,
            parentDirectoryUri: entry.uri,
            stateKind: 'loading',
            message: t('common.loading'),
          })
          continue
        }

        if (childListing.error) {
          list.push({
            kind: 'state',
            id: `${entry.uri}:error`,
            depth: depth + 1,
            parentDirectoryUri: entry.uri,
            stateKind: 'error',
            message: childListing.error,
          })
          continue
        }

        walk(entry.uri, depth + 1)
      }
    }

    walk(rootUri, 0)
    return list
  }, [directoryListings, expandedDirectoryUris, rootListing, rootUri, t])

  const entryRows = React.useMemo(
    () =>
      rows.filter(
        (row): row is Extract<SpaceExplorerRow, { kind: 'entry' }> => row.kind === 'entry',
      ),
    [rows],
  )

  const entriesByUri = React.useMemo(() => {
    const next = new Map<string, FileSystemEntry>()
    for (const listing of Object.values(directoryListings)) {
      for (const entry of listing.entries) {
        next.set(entry.uri, entry)
      }
    }
    return next
  }, [directoryListings])

  const selectEntry = React.useCallback((entry: FileSystemEntry | null) => {
    setSelectedEntryUri(entry?.uri ?? null)
    setSelectedEntryKind(entry?.kind ?? null)
  }, [])

  const actions = useSpaceExplorerOverlayActions({
    t,
    rootUri,
    findBlockingOpenDocument,
    onPreviewFile,
    onOpenFile,
    onDismissQuickPreview,
    onShowMessage,
    entriesByUri,
    entryRows,
    expandedDirectoryUris,
    setExpandedDirectoryUris,
    selectedEntryUri,
    selectEntry,
  })

  const mutations = useSpaceExplorerOverlayMutations({
    t,
    rootUri,
    mountId,
    explorerClipboard,
    setExplorerClipboard,
    closeContextMenu: actions.closeContextMenu,
    onShowMessage,
    directoryListings,
    entriesByUri,
    selectedEntryUri,
    selectedEntryKind,
    selectEntry,
    refresh,
    ensureEntryMutable: actions.ensureEntryMutable,
    setExpandedDirectoryUris,
    draggedEntryUri: actions.draggedEntryUri,
    setDropTargetDirectoryUri: actions.setDropTargetDirectoryUri,
  })

  const dismissTransientUi = React.useCallback(() => {
    let didClose = false

    if (actions.contextMenu) {
      actions.closeContextMenu()
      didClose = true
    }
    if (mutations.create.mode && !mutations.create.isCreating) {
      mutations.create.cancel()
      didClose = true
    }
    if (mutations.rename.entryUri && !mutations.rename.isRenaming) {
      mutations.rename.cancel()
      didClose = true
    }
    if (mutations.deleteConfirmation) {
      mutations.cancelDelete()
      didClose = true
    }
    if (actions.dropTargetDirectoryUri) {
      actions.setDropTargetDirectoryUri(null)
      didClose = true
    }

    return didClose
  }, [actions, mutations])

  const startRenameSelection = React.useCallback(() => {
    const entry = actions.resolveSelectedEntry()
    if (entry) {
      onDismissQuickPreview()
      mutations.rename.start(entry)
    }
  }, [actions, mutations.rename, onDismissQuickPreview])

  return {
    isLoadingRoot,
    rootError,
    rows,
    selectedEntryUri,
    selectEntry,
    refresh,
    create: mutations.create,
    rename: mutations.rename,
    contextMenu: actions.contextMenu,
    deleteConfirmation: mutations.deleteConfirmation,
    draggedEntryUri: actions.draggedEntryUri,
    dropTargetDirectoryUri: actions.dropTargetDirectoryUri,
    dismissTransientUi,
    copyPath: mutations.copyPath,
    copyRelativePath: mutations.copyRelativePath,
    canUndoMove: mutations.canUndoMove,
    canRedoMove: mutations.canRedoMove,
    undoMove: mutations.undoMove,
    redoMove: mutations.redoMove,
    openRootContextMenu: actions.openRootContextMenu,
    openEntryContextMenu: actions.openEntryContextMenu,
    closeContextMenu: actions.closeContextMenu,
    previewEntrySelection: actions.previewEntrySelection,
    openEntry: actions.openEntry,
    moveSelection: actions.moveSelection,
    collapseSelectionOrFocusParent: actions.collapseSelectionOrFocusParent,
    expandSelectionOrOpen: actions.expandSelectionOrOpen,
    requestDeleteSelection: mutations.requestDeleteSelection,
    startRenameSelection,
    copySelection: mutations.copySelection,
    cutSelection: mutations.cutSelection,
    pasteIntoSelectionTarget: mutations.pasteIntoSelectionTarget,
    handleEntryDragStart: actions.handleEntryDragStart,
    handleEntryDragEnd: actions.handleEntryDragEnd,
    handleDropTargetChange: actions.setDropTargetDirectoryUri,
    requestDropMove: mutations.requestDropMove,
    confirmDelete: mutations.confirmDelete,
    cancelDelete: mutations.cancelDelete,
  }
}

export function shouldHandleExplorerKeydown(event: KeyboardEvent): boolean {
  return !event.isComposing && !event.repeat && !isEditableTarget(event.target)
}
