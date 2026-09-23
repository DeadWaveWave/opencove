import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import { shouldStopWheelPropagation } from '../../../components/taskNode/helpers'
import {
  resolveParentDirectoryUri,
  type SpaceExplorerClipboardItem,
} from './WorkspaceSpaceExplorerOverlay.operations'
import type {
  SpaceExplorerCreateMode,
  SpaceExplorerRow,
} from './WorkspaceSpaceExplorerOverlay.model'
import { WorkspaceSpaceExplorerOverlayCreateRow } from './WorkspaceSpaceExplorerOverlayCreateRow'

import { WorkspaceDirectoryEntry } from './WorkspaceDirectoryEntry'

export interface WorkspaceSpaceExplorerTreeProps {
  navigationRootUri: string
  mountId: string | null
  sourceSpaceId: string | null
  viewMode: 'icons' | 'list'
  onDirectoryToggle: (entry: FileSystemEntry) => void
  spaceId: string
  rootUri: string
  isLoadingRoot: boolean
  rootError: string | null
  rows: SpaceExplorerRow[]
  isFilterActive: boolean
  createMode: SpaceExplorerCreateMode
  createTargetDirectoryUri: string | null
  createDraftName: string
  createError: string | null
  createIsCreating: boolean
  createInputRef: React.RefObject<HTMLInputElement | null>
  selectedEntryUri: string | null
  renameEntryUri: string | null
  renameDraftName: string
  renameError: string | null
  renameInputRef: React.RefObject<HTMLInputElement | null>
  draggedEntryUri: string | null
  dropTargetDirectoryUri: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  onRefresh: () => void
  onRootContextMenu: (point: { x: number; y: number }) => void
  onEntrySelect: (entry: FileSystemEntry) => void
  onEntryPreview: (entry: FileSystemEntry) => void
  onEntryOpen: (entry: FileSystemEntry) => void
  onEntryContextMenu: (entry: FileSystemEntry, point: { x: number; y: number }) => void
  onCreateDraftChange: (value: string) => void
  onCreateSubmit: () => Promise<void>
  onCreateCancel: () => void
  onRenameDraftChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onEntryDragStart: (entry: FileSystemEntry) => void
  onEntryDragEnd: () => void
  onDropTargetChange: (uri: string | null) => void
  onRequestDropMove: (targetDirectoryUri: string) => void
}

export function WorkspaceSpaceExplorerTree(
  props: WorkspaceSpaceExplorerTreeProps,
): React.JSX.Element {
  const {
    rootUri,
    isLoadingRoot,
    rootError,
    rows,
    isFilterActive,
    createMode,
    createTargetDirectoryUri,
    createDraftName,
    createError,
    createIsCreating,
    createInputRef,
    draggedEntryUri,
    dropTargetDirectoryUri,
    onRefresh,
    onRootContextMenu,
    onEntrySelect,
    onEntryPreview,
    onCreateDraftChange,
    onCreateSubmit,
    onCreateCancel,
    onDropTargetChange,
    onRequestDropMove,
  } = props
  const { viewMode } = props
  const { t } = useTranslation()
  const treeRef = React.useRef<HTMLDivElement | null>(null)
  const pendingFilePreviewTimerRef = React.useRef<number | null>(null)
  const clearPendingFilePreview = React.useCallback(() => {
    if (pendingFilePreviewTimerRef.current !== null) {
      window.clearTimeout(pendingFilePreviewTimerRef.current)
      pendingFilePreviewTimerRef.current = null
    }
  }, [])

  React.useLayoutEffect(() => {
    if (treeRef.current) {
      treeRef.current.scrollTop = 0
    }
    return clearPendingFilePreview
  }, [clearPendingFilePreview, rootUri])

  const resolveRowDropDirectoryUri = React.useCallback(
    (row: SpaceExplorerRow): string =>
      row.kind === 'state'
        ? row.parentDirectoryUri
        : row.entry.kind === 'directory'
          ? row.entry.uri
          : resolveParentDirectoryUri(row.entry.uri, rootUri),
    [rootUri],
  )

  const treeClassName =
    dropTargetDirectoryUri === rootUri
      ? 'workspace-space-explorer__tree workspace-space-explorer__tree--drop-target'
      : 'workspace-space-explorer__tree'

  const isCreateTargetVisible =
    !!createMode &&
    !!createTargetDirectoryUri &&
    createTargetDirectoryUri !== rootUri &&
    rows.some(
      row =>
        row.kind === 'entry' &&
        row.entry.kind === 'directory' &&
        row.entry.uri === createTargetDirectoryUri,
    )
  const shouldRenderCreateAtRoot =
    !!createMode &&
    !!createTargetDirectoryUri &&
    (createTargetDirectoryUri === rootUri || !isCreateTargetVisible)

  const renderCreateRow = (depth: number): React.JSX.Element | null =>
    createMode ? (
      <WorkspaceSpaceExplorerOverlayCreateRow
        mode={createMode}
        rootUri={rootUri}
        targetDirectoryUri={createTargetDirectoryUri}
        depth={depth}
        draftName={createDraftName}
        error={createError}
        isCreating={createIsCreating}
        inputRef={createInputRef}
        onDraftChange={onCreateDraftChange}
        onSubmit={onCreateSubmit}
        onCancel={onCreateCancel}
      />
    ) : null

  return (
    <div
      ref={treeRef}
      className={`${treeClassName}${viewMode === 'icons' ? ' workspace-space-explorer__tree--icons' : ''}`}
      data-testid="workspace-space-explorer-tree"
      role={viewMode === 'icons' ? 'listbox' : 'tree'}
      aria-label={t('spaceActions.files')}
      aria-busy={isLoadingRoot}
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
      onContextMenu={event => {
        if (
          event.target instanceof Element &&
          event.target.closest('.workspace-space-explorer__entry')
        ) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onRootContextMenu({ x: event.clientX, y: event.clientY })
      }}
      onDragOver={event => {
        if (!draggedEntryUri) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onDropTargetChange(rootUri)
      }}
      onDragLeave={event => {
        if (!draggedEntryUri || !event.relatedTarget || !(event.relatedTarget instanceof Node)) {
          onDropTargetChange(null)
        }
      }}
      onDrop={event => {
        if (!draggedEntryUri) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onRequestDropMove(rootUri)
      }}
    >
      {isLoadingRoot ? (
        <div className="workspace-space-explorer__state" role="status">
          {t('common.loading')}
        </div>
      ) : rootError ? (
        <div className="workspace-space-explorer__state workspace-space-explorer__state--error">
          <div className="workspace-space-explorer__state-title">{t('common.error')}</div>
          <div className="workspace-space-explorer__state-message">{rootError}</div>
          <button
            type="button"
            className="workspace-space-explorer__state-action"
            onClick={event => {
              event.stopPropagation()
              onRefresh()
            }}
          >
            {t('documentNode.retry')}
          </button>
        </div>
      ) : null}
      {!isLoadingRoot && !rootError && shouldRenderCreateAtRoot ? renderCreateRow(0) : null}
      {!isLoadingRoot && !rootError && rows.length === 0 && !createMode ? (
        <div className="workspace-space-explorer__state">
          {isFilterActive ? t('spaceExplorer.noMatches') : t('spaceExplorer.empty')}
        </div>
      ) : null}
      {(isLoadingRoot || rootError ? [] : rows).map(row => {
        if (row.kind === 'state') {
          const isWithinDropTargetScope =
            dropTargetDirectoryUri !== null &&
            dropTargetDirectoryUri !== rootUri &&
            row.parentDirectoryUri === dropTargetDirectoryUri

          return (
            <div
              key={row.id}
              className={
                row.stateKind === 'error'
                  ? `workspace-space-explorer__tree-state workspace-space-explorer__tree-state--error${
                      isWithinDropTargetScope
                        ? ' workspace-space-explorer__tree-state--drop-target-scope'
                        : ''
                    }`
                  : `workspace-space-explorer__tree-state${
                      isWithinDropTargetScope
                        ? ' workspace-space-explorer__tree-state--drop-target-scope'
                        : ''
                    }`
              }
              style={{ paddingLeft: `${16 + row.depth * 14}px` }}
              onDragOver={event => {
                if (!draggedEntryUri) {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                onDropTargetChange(resolveRowDropDirectoryUri(row))
              }}
              onDragLeave={event => {
                if (!draggedEntryUri) {
                  return
                }

                if (
                  event.relatedTarget instanceof Element &&
                  event.currentTarget.contains(event.relatedTarget)
                ) {
                  return
                }

                onDropTargetChange(null)
              }}
              onDrop={event => {
                if (!draggedEntryUri) {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                onRequestDropMove(resolveRowDropDirectoryUri(row))
              }}
            >
              {row.message}
            </div>
          )
        }

        return (
          <React.Fragment key={row.entry.uri}>
            <WorkspaceDirectoryEntry
              browser={props}
              row={row}
              onCancelPreview={clearPendingFilePreview}
              onPreview={entry => {
                onEntrySelect(entry)
                pendingFilePreviewTimerRef.current = window.setTimeout(() => {
                  pendingFilePreviewTimerRef.current = null
                  onEntryPreview(entry)
                }, 220)
              }}
            />
            {createMode && createTargetDirectoryUri === row.entry.uri && row.isExpanded
              ? renderCreateRow(row.depth + 1)
              : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}
