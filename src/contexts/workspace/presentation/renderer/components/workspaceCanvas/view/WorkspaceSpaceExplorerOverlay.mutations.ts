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
  resolveAvailablePasteTarget,
  resolveParentDirectoryUri,
  validateCreateName,
  type SpaceExplorerClipboardItem,
  type SpaceExplorerDeleteConfirmationState,
  type SpaceExplorerMoveConfirmationState,
} from './WorkspaceSpaceExplorerOverlay.operations'

export function useSpaceExplorerOverlayMutations({
  t,
  rootUri,
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
  const [createDraftName, setCreateDraftName] = React.useState('')
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [renameEntryUri, setRenameEntryUri] = React.useState<string | null>(null)
  const [renameDraftName, setRenameDraftName] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [deleteConfirmation, setDeleteConfirmation] =
    React.useState<SpaceExplorerDeleteConfirmationState | null>(null)
  const [moveConfirmation, setMoveConfirmation] =
    React.useState<SpaceExplorerMoveConfirmationState | null>(null)

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
      closeContextMenu()
      setRenameEntryUri(null)
      setRenameDraftName('')
      setRenameError(null)
      setCreateMode(mode)
      setCreateDraftName('')
      setCreateError(null)
    },
    [closeContextMenu],
  )

  const submitCreate = React.useCallback(async (): Promise<void> => {
    const api = window.opencoveApi?.filesystem
    if (!createMode || !api) {
      setCreateError(t('documentNode.filesystemUnavailable'))
      return
    }
    if (!validateCreateName(createDraftName)) {
      setCreateError(t('spaceExplorer.invalidName'))
      return
    }

    const baseUri = resolveCreateBaseUri()
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
    const api = window.opencoveApi?.filesystem
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
      const api = window.opencoveApi?.filesystem
      if (!api) {
        throw new Error(t('documentNode.filesystemUnavailable'))
      }
      return (await api.readDirectory({ uri: directoryUri })).entries
    },
    [directoryListings, t],
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
  const pasteIntoDirectory = React.useCallback(
    async (targetDirectoryUri: string): Promise<void> => {
      const api = window.opencoveApi?.filesystem
      if (!explorerClipboard || !api) {
        return
      }
      if (
        explorerClipboard.entry.kind === 'directory' &&
        (isSameFileUri(explorerClipboard.entry.uri, targetDirectoryUri) ||
          isWithinDirectoryUri(explorerClipboard.entry.uri, targetDirectoryUri))
      ) {
        onShowMessage?.(t('spaceExplorer.invalidMoveIntoSelf'), 'warning')
        return
      }
      if (explorerClipboard.mode === 'cut' && !ensureEntryMutable(explorerClipboard.entry)) {
        return
      }

      try {
        const targetUri = resolveAvailablePasteTarget({
          clipboard: explorerClipboard,
          targetDirectoryUri,
          siblingEntries: await readSiblingEntries(targetDirectoryUri),
        })
        if (!targetUri || isSameFileUri(targetUri, explorerClipboard.entry.uri)) {
          return
        }
        if (explorerClipboard.mode === 'cut') {
          await api.moveEntry({ sourceUri: explorerClipboard.entry.uri, targetUri })
          setExplorerClipboard(null)
        } else {
          await api.copyEntry({ sourceUri: explorerClipboard.entry.uri, targetUri })
        }
        selectEntry({ ...explorerClipboard.entry, uri: targetUri })
        refresh()
      } catch (error) {
        onShowMessage?.(toErrorMessage(error), 'error')
      }
    },
    [
      ensureEntryMutable,
      explorerClipboard,
      onShowMessage,
      readSiblingEntries,
      refresh,
      selectEntry,
      setExplorerClipboard,
      t,
    ],
  )
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

  const requestDeleteSelection = React.useCallback(() => {
    const entry = resolveSelectedEntry()
    if (!entry || !ensureEntryMutable(entry)) {
      return
    }
    closeContextMenu()
    setDeleteConfirmation({ entry })
  }, [closeContextMenu, ensureEntryMutable, resolveSelectedEntry])

  const confirmDelete = React.useCallback(async () => {
    const entry = deleteConfirmation?.entry
    const api = window.opencoveApi?.filesystem
    if (!entry || !api) {
      return
    }

    try {
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
      setDeleteConfirmation(null)
      refresh()
    } catch (error) {
      onShowMessage?.(toErrorMessage(error), 'error')
    }
  }, [
    deleteConfirmation,
    explorerClipboard,
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
        return
      }
      if (
        entry.kind === 'directory' &&
        (isSameFileUri(entry.uri, targetDirectoryUri) ||
          isWithinDirectoryUri(entry.uri, targetDirectoryUri))
      ) {
        onShowMessage?.(t('spaceExplorer.invalidMoveIntoSelf'), 'warning')
        return
      }

      setMoveConfirmation({ entry, targetDirectoryUri })
      setDropTargetDirectoryUri(null)
    },
    [
      draggedEntryUri,
      ensureEntryMutable,
      entriesByUri,
      onShowMessage,
      setDropTargetDirectoryUri,
      t,
    ],
  )
  const confirmMove = React.useCallback(async () => {
    const nextMove = moveConfirmation
    const api = window.opencoveApi?.filesystem
    if (!nextMove || !api) {
      return
    }
    const targetUri = buildChildUri(nextMove.targetDirectoryUri, nextMove.entry.name)
    if (!targetUri || isSameFileUri(targetUri, nextMove.entry.uri)) {
      setMoveConfirmation(null)
      return
    }

    try {
      await api.moveEntry({ sourceUri: nextMove.entry.uri, targetUri })
      if (
        explorerClipboard?.mode === 'cut' &&
        isSameFileUri(explorerClipboard.entry.uri, nextMove.entry.uri)
      ) {
        setExplorerClipboard(null)
      }
      selectEntry({ ...nextMove.entry, uri: targetUri })
      setMoveConfirmation(null)
      refresh()
    } catch (error) {
      onShowMessage?.(toErrorMessage(error), 'error')
    }
  }, [
    explorerClipboard,
    moveConfirmation,
    onShowMessage,
    refresh,
    selectEntry,
    setExplorerClipboard,
  ])

  return {
    create: {
      mode: createMode,
      draftName: createDraftName,
      error: createError,
      isCreating,
      start: startCreate,
      cancel: () => {
        setCreateMode(null)
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
    moveConfirmation,
    copySelection,
    cutSelection,
    copyPath,
    copyRelativePath,
    requestDeleteSelection,
    pasteIntoSelectionTarget: async () => {
      closeContextMenu()
      await pasteIntoDirectory(resolveSelectionTargetDirectory())
    },
    requestDropMove,
    confirmDelete,
    cancelDelete: () => setDeleteConfirmation(null),
    confirmMove,
    cancelMove: () => setMoveConfirmation(null),
  }
}
