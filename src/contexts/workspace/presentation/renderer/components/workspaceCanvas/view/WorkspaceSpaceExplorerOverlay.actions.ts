import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import {
  resolveParentDirectoryUri,
  type SpaceExplorerContextMenuState,
} from './WorkspaceSpaceExplorerOverlay.operations'
import type { SpaceExplorerRow } from './WorkspaceSpaceExplorerOverlay.model'

export function useSpaceExplorerOverlayActions({
  t,
  rootUri,
  findBlockingOpenDocument,
  onOpenFile,
  onShowMessage,
  entriesByUri,
  entryRows,
  expandedDirectoryUris,
  setExpandedDirectoryUris,
  selectedEntryUri,
  selectEntry,
}: {
  t: TranslateFn
  rootUri: string
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  onOpenFile: (uri: string) => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  entriesByUri: Map<string, FileSystemEntry>
  entryRows: Array<Extract<SpaceExplorerRow, { kind: 'entry' }>>
  expandedDirectoryUris: Set<string>
  setExpandedDirectoryUris: React.Dispatch<React.SetStateAction<Set<string>>>
  selectedEntryUri: string | null
  selectEntry: (entry: FileSystemEntry | null) => void
}) {
  const [contextMenu, setContextMenu] = React.useState<SpaceExplorerContextMenuState | null>(null)
  const [draggedEntryUri, setDraggedEntryUri] = React.useState<string | null>(null)
  const [dropTargetDirectoryUri, setDropTargetDirectoryUri] = React.useState<string | null>(null)

  const resolveSelectedEntry = React.useCallback(
    (): FileSystemEntry | null =>
      selectedEntryUri ? (entriesByUri.get(selectedEntryUri) ?? null) : null,
    [entriesByUri, selectedEntryUri],
  )

  const showBlockingMessage = React.useCallback(
    (block: SpaceExplorerOpenDocumentBlock) => {
      onShowMessage?.(
        t('spaceExplorer.closeDocumentBeforeFileChange', { name: block.title }),
        'warning',
      )
    },
    [onShowMessage, t],
  )

  const ensureEntryMutable = React.useCallback(
    (entry: FileSystemEntry): boolean => {
      const block = findBlockingOpenDocument(entry.uri)
      if (!block) {
        return true
      }

      showBlockingMessage(block)
      return false
    },
    [findBlockingOpenDocument, showBlockingMessage],
  )

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleEntryActivate = React.useCallback(
    (entry: FileSystemEntry) => {
      selectEntry(entry)
      closeContextMenu()

      if (entry.kind === 'directory') {
        setExpandedDirectoryUris(previous => {
          const next = new Set(previous)
          if (next.has(entry.uri)) {
            next.delete(entry.uri)
          } else {
            next.add(entry.uri)
          }
          return next
        })
        return
      }

      onOpenFile(entry.uri)
    },
    [closeContextMenu, onOpenFile, selectEntry, setExpandedDirectoryUris],
  )

  const moveSelection = React.useCallback(
    (direction: 'next' | 'previous') => {
      if (entryRows.length === 0) {
        return
      }

      const currentIndex = entryRows.findIndex(row => row.entry.uri === selectedEntryUri)
      const nextIndex =
        currentIndex < 0
          ? direction === 'next'
            ? 0
            : entryRows.length - 1
          : Math.min(
              entryRows.length - 1,
              Math.max(0, currentIndex + (direction === 'next' ? 1 : -1)),
            )

      selectEntry(entryRows[nextIndex]?.entry ?? null)
    },
    [entryRows, selectEntry, selectedEntryUri],
  )

  const collapseSelectionOrFocusParent = React.useCallback(() => {
    const entry = resolveSelectedEntry()
    if (!entry) {
      return
    }

    if (entry.kind === 'directory' && expandedDirectoryUris.has(entry.uri)) {
      setExpandedDirectoryUris(previous => {
        const next = new Set(previous)
        next.delete(entry.uri)
        return next
      })
      return
    }

    const parentUri = resolveParentDirectoryUri(entry.uri, rootUri)
    if (parentUri !== rootUri) {
      selectEntry(entriesByUri.get(parentUri) ?? null)
    }
  }, [
    entriesByUri,
    expandedDirectoryUris,
    resolveSelectedEntry,
    rootUri,
    selectEntry,
    setExpandedDirectoryUris,
  ])

  const expandSelectionOrOpen = React.useCallback(() => {
    const entry = resolveSelectedEntry()
    if (!entry) {
      return
    }

    if (entry.kind === 'directory' && !expandedDirectoryUris.has(entry.uri)) {
      setExpandedDirectoryUris(previous => new Set(previous).add(entry.uri))
      return
    }

    handleEntryActivate(entry)
  }, [expandedDirectoryUris, handleEntryActivate, resolveSelectedEntry, setExpandedDirectoryUris])

  const openRootContextMenu = React.useCallback(
    (point: { x: number; y: number }) => {
      selectEntry(null)
      setContextMenu({ kind: 'root', x: point.x, y: point.y, entry: null })
    },
    [selectEntry],
  )

  const openEntryContextMenu = React.useCallback(
    (entry: FileSystemEntry, point: { x: number; y: number }) => {
      selectEntry(entry)
      setContextMenu({ kind: 'entry', x: point.x, y: point.y, entry })
    },
    [selectEntry],
  )

  const handleEntryDragStart = React.useCallback(
    (entry: FileSystemEntry) => {
      closeContextMenu()
      setDraggedEntryUri(entry.uri)
      setDropTargetDirectoryUri(null)
      selectEntry(entry)
    },
    [closeContextMenu, selectEntry],
  )

  const handleEntryDragEnd = React.useCallback(() => {
    setDraggedEntryUri(null)
    setDropTargetDirectoryUri(null)
  }, [])

  return {
    contextMenu,
    draggedEntryUri,
    dropTargetDirectoryUri,
    ensureEntryMutable,
    resolveSelectedEntry,
    closeContextMenu,
    handleEntryActivate,
    moveSelection,
    collapseSelectionOrFocusParent,
    expandSelectionOrOpen,
    openRootContextMenu,
    openEntryContextMenu,
    handleEntryDragStart,
    handleEntryDragEnd,
    setDropTargetDirectoryUri,
  }
}
