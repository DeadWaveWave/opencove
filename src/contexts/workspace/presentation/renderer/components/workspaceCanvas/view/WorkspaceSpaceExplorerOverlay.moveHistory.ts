import React from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { toErrorMessage } from '../helpers'
import {
  isSameFileUri,
  isWithinDirectoryUri,
  resolveAvailablePasteTarget,
  resolveEntryMovePlan,
  resolveEntryNameFromUri,
  type SpaceExplorerClipboardItem,
  type SpaceExplorerMoveHistoryEntry,
} from './WorkspaceSpaceExplorerOverlay.operations'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'

const MAX_MOVE_HISTORY = 100

function pushMoveHistoryEntry(
  stack: SpaceExplorerMoveHistoryEntry[],
  entry: SpaceExplorerMoveHistoryEntry,
): SpaceExplorerMoveHistoryEntry[] {
  return [...stack.slice(-(MAX_MOVE_HISTORY - 1)), entry]
}

export function useSpaceExplorerOverlayMoveHistory({
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
}: {
  t: TranslateFn
  mountId: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  readSiblingEntries: (directoryUri: string) => Promise<FileSystemEntry[]>
  refresh: () => void
  selectEntry: (entry: FileSystemEntry | null) => void
  ensureEntryMutable: (entry: FileSystemEntry) => boolean
  setDropTargetDirectoryUri: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const [moveUndoStack, setMoveUndoStack] = React.useState<SpaceExplorerMoveHistoryEntry[]>([])
  const [moveRedoStack, setMoveRedoStack] = React.useState<SpaceExplorerMoveHistoryEntry[]>([])

  const selectMovedEntry = React.useCallback(
    (uri: string, entryKind: FileSystemEntry['kind'], fallbackName: string) => {
      selectEntry({
        uri,
        kind: entryKind,
        name: resolveEntryNameFromUri(uri, fallbackName),
      })
    },
    [selectEntry],
  )

  const applyMoveByUri = React.useCallback(
    async (options: {
      sourceUri: string
      targetUri: string
      entryKind: FileSystemEntry['kind']
      fallbackName: string
    }): Promise<boolean> => {
      const api = resolveFilesystemApiForMount(mountId)
      if (!api) {
        onShowMessage?.(t('documentNode.filesystemUnavailable'), 'error')
        return false
      }

      try {
        await api.moveEntry({
          sourceUri: options.sourceUri,
          targetUri: options.targetUri,
        })
        if (
          explorerClipboard?.mode === 'cut' &&
          isSameFileUri(explorerClipboard.entry.uri, options.sourceUri)
        ) {
          setExplorerClipboard(null)
        }
        selectMovedEntry(options.targetUri, options.entryKind, options.fallbackName)
        refresh()
        return true
      } catch (error) {
        onShowMessage?.(toErrorMessage(error), 'error')
        return false
      }
    },
    [explorerClipboard, mountId, onShowMessage, refresh, selectMovedEntry, setExplorerClipboard, t],
  )

  const executeMove = React.useCallback(
    async (entry: FileSystemEntry, targetDirectoryUri: string): Promise<boolean> => {
      const movePlan = resolveEntryMovePlan({ entry, targetDirectoryUri })
      setDropTargetDirectoryUri(null)

      if (movePlan.kind === 'noop') {
        return false
      }

      if (movePlan.kind === 'invalid-descendant') {
        onShowMessage?.(t('spaceExplorer.invalidMoveIntoSelf'), 'warning')
        return false
      }

      if (movePlan.kind === 'invalid-target') {
        onShowMessage?.(t('spaceExplorer.moveFailed'), 'error')
        return false
      }

      const didMove = await applyMoveByUri({
        sourceUri: entry.uri,
        targetUri: movePlan.targetUri,
        entryKind: entry.kind,
        fallbackName: entry.name,
      })
      if (!didMove) {
        return false
      }

      setMoveUndoStack(previous =>
        pushMoveHistoryEntry(previous, {
          entryKind: entry.kind,
          sourceUri: entry.uri,
          targetUri: movePlan.targetUri,
        }),
      )
      setMoveRedoStack([])
      return true
    },
    [applyMoveByUri, onShowMessage, setDropTargetDirectoryUri, t],
  )

  const pasteIntoDirectory = React.useCallback(
    async (targetDirectoryUri: string): Promise<void> => {
      const api = resolveFilesystemApiForMount(mountId)
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
        if (explorerClipboard.mode === 'cut') {
          await executeMove(explorerClipboard.entry, targetDirectoryUri)
          return
        }

        const targetUri = resolveAvailablePasteTarget({
          clipboard: explorerClipboard,
          targetDirectoryUri,
          siblingEntries: await readSiblingEntries(targetDirectoryUri),
        })
        if (!targetUri || isSameFileUri(targetUri, explorerClipboard.entry.uri)) {
          return
        }
        await api.copyEntry({ sourceUri: explorerClipboard.entry.uri, targetUri })
        selectEntry({ ...explorerClipboard.entry, uri: targetUri })
        refresh()
      } catch (error) {
        onShowMessage?.(toErrorMessage(error), 'error')
      }
    },
    [
      ensureEntryMutable,
      executeMove,
      explorerClipboard,
      mountId,
      onShowMessage,
      readSiblingEntries,
      refresh,
      selectEntry,
      t,
    ],
  )

  const undoMove = React.useCallback(async (): Promise<void> => {
    const lastMove = moveUndoStack.at(-1)
    if (!lastMove) {
      return
    }

    const didUndo = await applyMoveByUri({
      sourceUri: lastMove.targetUri,
      targetUri: lastMove.sourceUri,
      entryKind: lastMove.entryKind,
      fallbackName: resolveEntryNameFromUri(lastMove.sourceUri),
    })
    if (!didUndo) {
      return
    }

    setMoveUndoStack(previous => previous.slice(0, -1))
    setMoveRedoStack(previous => pushMoveHistoryEntry(previous, lastMove))
  }, [applyMoveByUri, moveUndoStack])

  const redoMove = React.useCallback(async (): Promise<void> => {
    const lastMove = moveRedoStack.at(-1)
    if (!lastMove) {
      return
    }

    const didRedo = await applyMoveByUri({
      sourceUri: lastMove.sourceUri,
      targetUri: lastMove.targetUri,
      entryKind: lastMove.entryKind,
      fallbackName: resolveEntryNameFromUri(lastMove.targetUri),
    })
    if (!didRedo) {
      return
    }

    setMoveRedoStack(previous => previous.slice(0, -1))
    setMoveUndoStack(previous => pushMoveHistoryEntry(previous, lastMove))
  }, [applyMoveByUri, moveRedoStack])

  return {
    canUndoMove: moveUndoStack.length > 0,
    canRedoMove: moveRedoStack.length > 0,
    executeMove,
    pasteIntoDirectory,
    undoMove,
    redoMove,
  }
}
