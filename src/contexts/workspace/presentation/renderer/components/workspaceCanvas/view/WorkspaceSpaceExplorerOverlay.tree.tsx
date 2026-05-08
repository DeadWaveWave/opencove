import React from 'react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import { shouldStopWheelPropagation } from '../../../components/taskNode/helpers'
import { isExplorerOverlayInteractionSuppressed } from '../explorerInteractionGuard'
import {
  resolveParentDirectoryUri,
  type SpaceExplorerClipboardItem,
} from './WorkspaceSpaceExplorerOverlay.operations'
import type {
  SpaceExplorerCreateMode,
  SpaceExplorerRow,
} from './WorkspaceSpaceExplorerOverlay.model'
import { WorkspaceSpaceExplorerOverlayCreateRow } from './WorkspaceSpaceExplorerOverlayCreateRow'

function renderRowDisclosure(row: Extract<SpaceExplorerRow, { kind: 'entry' }>): React.JSX.Element {
  if (row.entry.kind !== 'directory') {
    return <span className="workspace-space-explorer__entry-disclosure-placeholder" />
  }

  return row.isExpanded ? <ChevronDown /> : <ChevronRight />
}

export function WorkspaceSpaceExplorerTree({
  spaceId,
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
  selectedEntryUri,
  renameEntryUri,
  renameDraftName,
  renameError,
  renameInputRef,
  draggedEntryUri,
  dropTargetDirectoryUri,
  explorerClipboard,
  onRefresh,
  onRootContextMenu,
  onEntrySelect,
  onEntryPreview,
  onEntryOpen,
  onEntryContextMenu,
  onCreateDraftChange,
  onCreateSubmit,
  onCreateCancel,
  onRenameDraftChange,
  onRenameSubmit,
  onRenameCancel,
  onEntryDragStart,
  onEntryDragEnd,
  onDropTargetChange,
  onRequestDropMove,
}: {
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
}): React.JSX.Element {
  const { t } = useTranslation()
  const pendingFilePreviewTimerRef = React.useRef<number | null>(null)
  const clearPendingFilePreview = React.useCallback(() => {
    if (pendingFilePreviewTimerRef.current !== null) {
      window.clearTimeout(pendingFilePreviewTimerRef.current)
      pendingFilePreviewTimerRef.current = null
    }
  }, [])

  React.useEffect(() => clearPendingFilePreview, [clearPendingFilePreview])

  const resolveRowDropDirectoryUri = React.useCallback(
    (row: SpaceExplorerRow): string =>
      row.kind === 'state'
        ? row.parentDirectoryUri
        : row.entry.kind === 'directory'
          ? row.entry.uri
          : resolveParentDirectoryUri(row.entry.uri, rootUri),
    [rootUri],
  )

  if (isLoadingRoot) {
    return <div className="workspace-space-explorer__state">{t('common.loading')}</div>
  }

  if (rootError) {
    return (
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
    )
  }

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
      className={treeClassName}
      data-testid="workspace-space-explorer-tree"
      role="tree"
      aria-label={t('spaceActions.files')}
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
      {shouldRenderCreateAtRoot ? renderCreateRow(0) : null}
      {rows.length === 0 && !createMode ? (
        <div className="workspace-space-explorer__state">
          {isFilterActive ? t('spaceExplorer.noMatches') : t('spaceExplorer.empty')}
        </div>
      ) : null}
      {rows.map(row => {
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

        const isSelected = selectedEntryUri === row.entry.uri
        const isRenaming = renameEntryUri === row.entry.uri
        const isCut =
          explorerClipboard?.mode === 'cut' && explorerClipboard.entry.uri === row.entry.uri
        const isDropTarget =
          dropTargetDirectoryUri === row.entry.uri && row.entry.kind === 'directory'
        const isWithinDropTargetScope =
          dropTargetDirectoryUri !== null &&
          dropTargetDirectoryUri !== rootUri &&
          resolveParentDirectoryUri(row.entry.uri, rootUri) === dropTargetDirectoryUri
        const className = [
          'workspace-space-explorer__entry',
          isSelected ? 'workspace-space-explorer__entry--selected' : '',
          isCut ? 'workspace-space-explorer__entry--cut' : '',
          isDropTarget ? 'workspace-space-explorer__entry--drop-target' : '',
          isWithinDropTargetScope ? 'workspace-space-explorer__entry--drop-target-scope' : '',
        ]
          .filter(Boolean)
          .join(' ')

        if (isRenaming) {
          return (
            <form
              key={row.entry.uri}
              className="workspace-space-explorer__rename"
              style={{ paddingLeft: `${10 + row.depth * 14}px` }}
              onSubmit={event => {
                event.preventDefault()
                event.stopPropagation()
                void onRenameSubmit()
              }}
              onBlur={event => {
                if (
                  isRenaming &&
                  !(
                    event.relatedTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  )
                ) {
                  onRenameCancel()
                }
              }}
            >
              <span className="workspace-space-explorer__entry-disclosure" aria-hidden="true">
                {renderRowDisclosure(row)}
              </span>
              {row.entry.kind === 'directory' ? (
                <Folder className="workspace-space-explorer__entry-icon" aria-hidden="true" />
              ) : (
                <FileText className="workspace-space-explorer__entry-icon" aria-hidden="true" />
              )}
              <input
                ref={renameInputRef}
                className="workspace-space-explorer__rename-input"
                value={renameDraftName}
                onChange={event => {
                  onRenameDraftChange(event.target.value)
                }}
                onKeyDown={event => {
                  if (event.key !== 'Escape') {
                    return
                  }

                  event.preventDefault()
                  event.stopPropagation()
                  onRenameCancel()
                }}
              />
              {renameError ? (
                <div className="workspace-space-explorer__rename-error">{renameError}</div>
              ) : null}
            </form>
          )
        }

        return (
          <React.Fragment key={row.entry.uri}>
            <button
              type="button"
              draggable
              tabIndex={-1}
              role="treeitem"
              aria-selected={isSelected}
              aria-expanded={row.entry.kind === 'directory' ? row.isExpanded : undefined}
              className={className}
              data-testid={`workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(row.entry.uri)}`}
              title={row.entry.name}
              style={{ paddingLeft: `${10 + row.depth * 14}px` }}
              onClick={event => {
                event.stopPropagation()
                clearPendingFilePreview()
                if (isExplorerOverlayInteractionSuppressed()) {
                  return
                }

                if (row.entry.kind === 'directory') {
                  onEntryPreview(row.entry)
                  return
                }

                onEntrySelect(row.entry)
                pendingFilePreviewTimerRef.current = window.setTimeout(() => {
                  pendingFilePreviewTimerRef.current = null
                  onEntryPreview(row.entry)
                }, 220)
              }}
              onDoubleClick={event => {
                event.stopPropagation()
                clearPendingFilePreview()
                if (isExplorerOverlayInteractionSuppressed()) {
                  return
                }
                onEntryOpen(row.entry)
              }}
              onContextMenu={event => {
                event.preventDefault()
                event.stopPropagation()
                clearPendingFilePreview()
                onEntryContextMenu(row.entry, { x: event.clientX, y: event.clientY })
              }}
              onDragStart={event => {
                event.stopPropagation()
                clearPendingFilePreview()
                event.dataTransfer.effectAllowed = 'move'
                onEntryDragStart(row.entry)
              }}
              onDragEnd={event => {
                event.stopPropagation()
                onEntryDragEnd()
              }}
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
              <span className="workspace-space-explorer__entry-disclosure" aria-hidden="true">
                {renderRowDisclosure(row)}
              </span>
              {row.entry.kind === 'directory' ? (
                <Folder className="workspace-space-explorer__entry-icon" aria-hidden="true" />
              ) : (
                <FileText className="workspace-space-explorer__entry-icon" aria-hidden="true" />
              )}
              <span className="workspace-space-explorer__entry-label">{row.entry.name}</span>
            </button>
            {createMode &&
            createTargetDirectoryUri === row.entry.uri &&
            row.entry.kind === 'directory'
              ? renderCreateRow(row.depth + 1)
              : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}
