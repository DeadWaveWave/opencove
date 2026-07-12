import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { toErrorMessage } from '../helpers'
import type { SpaceExplorerCreateMode } from './WorkspaceSpaceExplorerOverlay.model'
import {
  copyExplorerAbsolutePath,
  copyExplorerRelativePath,
} from './WorkspaceSpaceExplorerOverlay.clipboard'
import {
  buildChildUri,
  isSameFileUri,
  isWithinDirectoryUri,
  resolveParentDirectoryUri,
  validateCreateName,
  type SpaceExplorerClipboardItem,
  type SpaceExplorerDeleteConfirmationState,
} from './WorkspaceSpaceExplorerOverlay.operations'
import { useSpaceExplorerOverlayMoveHistory } from './WorkspaceSpaceExplorerOverlay.moveHistory'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'

export function useSpaceExplorerOverlayMutations({
  t,
  rootUri,
  mountId,
  explorerClipboard,
  setExplorerClipboard,
  closeContextMenu,
  onShowMessage,
  directoryListings,
  entriesByUri,
  selectedEntryUri,
  selectedEntryKind,
  selectEntry,
  refresh,
  ensureEntryMutable,
  setExpandedDirectoryUris,
  draggedEntryUri,
  setDropTargetDirectoryUri,
}: {
  t: TranslateFn
  rootUri: string
  mountId: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  closeContextMenu: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  directoryListings: Record<
    string,
    { entries: FileSystemEntry[]; isLoading: boolean; error: string | null }
  >
  entriesByUri: Map<string, FileSystemEntry>
  selectedEntryUri: string | null
  selectedEntryKind: FileSystemEntry['kind'] | null
  selectEntry: (entry: FileSystemEntry | null) => void
  refresh: () => void
  ensureEntryMutable: (entry: FileSystemEntry) => boolean
  setExpandedDirectoryUris: React.Dispatch<React.SetStateAction<Set<string>>>
  draggedEntryUri: string | null
  setDropTargetDirectoryUri: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const [createMode, setCreateMode] = React.useState<SpaceExplorerCreateMode>(null)
  const [createTargetDirectoryUri, setCreateTargetDirectoryUri] = React.useState<string | null>(
    null,
  )
  const [createDraftName, setCreateDraftName] = React.useState('')
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [renameEntryUri, setRenameEntryUri] = React.useState<string | null>(null)
  const [renameDraftName, setRenameDraftName] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [deleteConfirmation, setDeleteConfirmation] =
    React.useState<SpaceExplorerDeleteConfirmationState | null>(null)

  const resolveSelectedEntry = React.useCallback(
    (): FileSystemEntry | null =>
      selectedEntryUri ? (entriesByUri.get(selectedEntryUri) ?? null) : null,
    [entriesByUri, selectedEntryUri],
  )

  const resolveCreateBaseUri = React.useCallback((): string => {
    if (selectedEntryUri && selectedEntryKind === 'directory') {
      return selectedEntryUri
    }
    if (selectedEntryUri && selectedEntryKind === 'file') {
      return resolveParentDirectoryUri(selectedEntryUri, rootUri)
    }
    return rootUri
  }, [rootUri, selectedEntryKind, selectedEntryUri])

  const startCreate = React.useCallback(
    (mode: Exclude<SpaceExplorerCreateMode, null>) => {
      const targetDirectoryUri = resolveCreateBaseUri()
      closeContextMenu()
      setRenameEntryUri(null)
      setRenameDraftName('')
      setRenameError(null)
      setCreateMode(mode)
      setCreateTargetDirectoryUri(targetDirectoryUri)
      setCreateDraftName('')
      setCreateError(null)
      if (targetDirectoryUri !== rootUri) {
        setExpandedDirectoryUris(previous => new Set(previous).add(targetDirectoryUri))
      }
    },
    [closeContextMenu, resolveCreateBaseUri, rootUri, setExpandedDirectoryUris],
  )

  const submitCreate = React.useCallback(async (): Promise<void> => {
    const api = resolveFilesystemApiForMount(mountId)
    if (!createMode || !api) {
      setCreateError(t('documentNode.filesystemUnavailable'))
      return
    }
    if (!validateCreateName(createDraftName)) {
      setCreateError(t('spaceExplorer.invalidName'))
      return
    }

    const baseUri = createTargetDirectoryUri ?? resolveCreateBaseUri()
    const targetUri = buildChildUri(baseUri, createDraftName)
    if (!targetUri) {
      setCreateError(t('spaceExplorer.createFailed'))
      return
    }

    setIsCreating(true)
    setCreateError(null)
    try {
      if (createMode === 'directory') {
        await api.createDirectory({ uri: targetUri })
        setExpandedDirectoryUris(previous => new Set(previous).add(baseUri))
      } else {
        await api.writeFileText({ uri: targetUri, content: '' })
      }
      selectEntry({
        uri: targetUri,
        name: createDraftName.trim(),
        kind: createMode === 'directory' ? 'directory' : 'file',
      })
      setCreateMode(null)
      setCreateTargetDirectoryUri(null)
      setCreateDraftName('')
      refresh()
    } catch (error) {
      setCreateError(toErrorMessage(error))
    } finally {
      setIsCreating(false)
    }
  }, [
    createDraftName,
    createMode,
    createTargetDirectoryUri,
    mountId,
    refresh,
    resolveCreateBaseUri,
    selectEntry,
    setExpandedDirectoryUris,
    t,
  ])
  const startRename = React.useCallback(
    (entry: FileSystemEntry) => {
      if (!ensureEntryMutable(entry)) {
        return
      }

      closeContextMenu()
      setCreateMode(null)
      setCreateTargetDirectoryUri(null)
      setCreateDraftName('')
      setCreateError(null)
      setRenameEntryUri(entry.uri)
      setRenameDraftName(entry.name)
      setRenameError(null)
      selectEntry(entry)
    },
    [closeContextMenu, ensureEntryMutable, selectEntry],
  )
  const submitRename = React.useCallback(async (): Promise<void> => {
    const entry = renameEntryUri ? (entriesByUri.get(renameEntryUri) ?? null) : null
    const api = resolveFilesystemApiForMount(mountId)
    if (!entry || !api) {
      setRenameError(t('documentNode.filesystemUnavailable'))
      return
    }
    if (!validateCreateName(renameDraftName)) {
      setRenameError(t('spaceExplorer.invalidName'))
      return
    }
    if (entry.name === renameDraftName.trim()) {
      setRenameEntryUri(null)
      setRenameDraftName('')
      setRenameError(null)
      return
    }

    const targetUri = buildChildUri(resolveParentDirectoryUri(entry.uri, rootUri), renameDraftName)
    if (!targetUri) {
      setRenameError(t('spaceExplorer.renameFailed'))
      return
    }

    setIsRenaming(true)
    setRenameError(null)
    try {
      await api.renameEntry({ sourceUri: entry.uri, targetUri })
      if (
        explorerClipboard?.mode === 'cut' &&
        isSameFileUri(explorerClipboard.entry.uri, entry.uri)
      ) {
        setExplorerClipboard(null)
      }
      selectEntry({ ...entry, uri: targetUri, name: renameDraftName.trim() })
      setRenameEntryUri(null)
      setRenameDraftName('')
      refresh()
    } catch (error) {
      setRenameError(toErrorMessage(error))
    } finally {
      setIsRenaming(false)
    }
  }, [
    entriesByUri,
    explorerClipboard,
    mountId,
    refresh,
    renameDraftName,
    renameEntryUri,
    rootUri,
    selectEntry,
    setExplorerClipboard,
    t,
  ])
  const readSiblingEntries = React.useCallback(
    async (directoryUri: string): Promise<FileSystemEntry[]> => {
      const listing = directoryListings[directoryUri]
      if (listing && !listing.isLoading && !listing.error) {
        return listing.entries
      }
      const api = resolveFilesystemApiForMount(mountId)
      if (!api) {
        throw new Error(t('documentNode.filesystemUnavailable'))
      }
      return (await api.readDirectory({ uri: directoryUri })).entries
    },
    [directoryListings, mountId, t],
  )

  const resolveSelectionTargetDirectory = React.useCallback((): string => {
    if (selectedEntryUri && selectedEntryKind === 'directory') {
      return selectedEntryUri
    }
    if (selectedEntryUri && selectedEntryKind === 'file') {
      return resolveParentDirectoryUri(selectedEntryUri, rootUri)
    }
    return rootUri
  }, [rootUri, selectedEntryKind, selectedEntryUri])

  const { canUndoMove, canRedoMove, executeMove, pasteIntoDirectory, undoMove, redoMove } =
    useSpaceExplorerOverlayMoveHistory({
      t,
      mountId,
      explorerClipboard,
      setExplorerClipboard,
      onShowMessage,
      readSiblingEntries,
      refresh,
      selectEntry,
      ensureEntryMutable,
      setDropTargetDirectoryUri,
    })

  const copyPath = React.useCallback(
    async (uri?: string) =>
      copyExplorerAbsolutePath({
        uri,
        rootUri,
        selectedEntryUri,
        closeContextMenu,
        t,
        onShowMessage,
      }),
    [closeContextMenu, onShowMessage, rootUri, selectedEntryUri, t],
  )

  const copyRelativePath = React.useCallback(
    async (uri?: string) =>
      copyExplorerRelativePath({
        uri,
        rootUri,
        selectedEntryUri,
        closeContextMenu,
        t,
        onShowMessage,
      }),
    [closeContextMenu, onShowMessage, rootUri, selectedEntryUri, t],
  )

  const copySelection = React.useCallback(() => {
    const entry = resolveSelectedEntry()
    if (!entry) {
      return
    }
    closeContextMenu()
    setExplorerClipboard({ mode: 'copy', entry })
  }, [closeContextMenu, resolveSelectedEntry, setExplorerClipboard])

  const cutSelection = React.useCallback(() => {
    const entry = resolveSelectedEntry()
    if (!entry || !ensureEntryMutable(entry)) {
      return
    }
    closeContextMenu()
    setExplorerClipboard({ mode: 'cut', entry })
  }, [closeContextMenu, ensureEntryMutable, resolveSelectedEntry, setExplorerClipboard])

  const requestDeleteSelection = React.useCallback(
    (anchor?: { x: number; y: number }) => {
      const entry = resolveSelectedEntry()
      if (!entry || !ensureEntryMutable(entry)) {
        return
      }
      closeContextMenu()
      setDeleteConfirmation({
        entry,
        anchor: anchor ?? {
          x: Math.round(window.innerWidth / 2),
          y: Math.round(window.innerHeight / 2),
        },
      })
    },
    [closeContextMenu, ensureEntryMutable, resolveSelectedEntry],
  )

  const confirmDelete = React.useCallback(async () => {
    const entry = deleteConfirmation?.entry
    const api = resolveFilesystemApiForMount(mountId)
    if (!entry || !api) {
      return
    }

    try {
      setDeleteConfirmation(null)
      await api.deleteEntry({ uri: entry.uri })
      if (
        explorerClipboard?.mode === 'cut' &&
        isSameFileUri(explorerClipboard.entry.uri, entry.uri)
      ) {
        setExplorerClipboard(null)
      }
      if (selectedEntryUri && isWithinDirectoryUri(entry.uri, selectedEntryUri)) {
        selectEntry(null)
      }
      refresh()
    } catch (error) {
      onShowMessage?.(toErrorMessage(error), 'error')
    }
  }, [
    deleteConfirmation,
    explorerClipboard,
    mountId,
    onShowMessage,
    refresh,
    selectedEntryUri,
    selectEntry,
    setExplorerClipboard,
  ])

  const requestDropMove = React.useCallback(
    (targetDirectoryUri: string) => {
      const entry = draggedEntryUri ? (entriesByUri.get(draggedEntryUri) ?? null) : null
      if (!entry || !ensureEntryMutable(entry)) {
        setDropTargetDirectoryUri(null)
        return
      }

      void executeMove(entry, targetDirectoryUri)
    },
    [draggedEntryUri, ensureEntryMutable, entriesByUri, executeMove, setDropTargetDirectoryUri],
  )

  return {
    create: {
      mode: createMode,
      targetDirectoryUri: createTargetDirectoryUri,
      draftName: createDraftName,
      error: createError,
      isCreating,
      start: startCreate,
      cancel: () => {
        setCreateMode(null)
        setCreateTargetDirectoryUri(null)
        setCreateDraftName('')
        setCreateError(null)
      },
      setDraftName: (value: string) => {
        setCreateDraftName(value)
        if (createError) {
          setCreateError(null)
        }
      },
      submit: submitCreate,
    },
    rename: {
      entryUri: renameEntryUri,
      draftName: renameDraftName,
      error: renameError,
      isRenaming,
      start: startRename,
      cancel: () => {
        setRenameEntryUri(null)
        setRenameDraftName('')
        setRenameError(null)
      },
      setDraftName: (value: string) => {
        setRenameDraftName(value)
        if (renameError) {
          setRenameError(null)
        }
      },
      submit: submitRename,
    },
    deleteConfirmation,
    copySelection,
    cutSelection,
    copyPath,
    copyRelativePath,
    canUndoMove,
    canRedoMove,
    undoMove,
    redoMove,
    requestDeleteSelection,
    pasteIntoSelectionTarget: async () => {
      closeContextMenu()
      await pasteIntoDirectory(resolveSelectionTargetDirectory())
    },
    requestDropMove,
    confirmDelete,
    cancelDelete: () => setDeleteConfirmation(null),
  }
}
