import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import { decodeUriPathname } from '../../DocumentNode.helpers'
import { FileSystemEntryIcon } from '../../shared/FileSystemEntryIcon'
import { isExplorerOverlayInteractionSuppressed } from '../explorerInteractionGuard'
import { setFilesystemEntryDragData } from '../filesystemDrag'
import { resolveParentDirectoryUri } from './WorkspaceSpaceExplorerOverlay.operations'
import type { SpaceExplorerRow } from './WorkspaceSpaceExplorerOverlay.model'
import type { WorkspaceSpaceExplorerTreeProps } from './WorkspaceSpaceExplorerOverlay.tree'

export function WorkspaceDirectoryEntry({
  browser,
  row,
  onPreview,
  onCancelPreview,
}: {
  browser: WorkspaceSpaceExplorerTreeProps
  row: Extract<SpaceExplorerRow, { kind: 'entry' }>
  onPreview: (entry: FileSystemEntry) => void
  onCancelPreview: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    rootUri,
    navigationRootUri,
    mountId,
    sourceSpaceId,
    viewMode,
    spaceId,
    selectedEntryUri,
    renameEntryUri,
    renameDraftName,
    renameError,
    renameInputRef,
    draggedEntryUri,
    dropTargetDirectoryUri,
    explorerClipboard,
    onEntryOpen,
    onEntryContextMenu,
    onDirectoryToggle,
    onRenameDraftChange,
    onRenameSubmit,
    onRenameCancel,
    onEntryDragStart,
    onEntryDragEnd,
    onDropTargetChange,
    onRequestDropMove,
  } = browser
  const entry = row.entry
  const parentUri = resolveParentDirectoryUri(entry.uri, rootUri)
  const dropDirectoryUri = entry.kind === 'directory' ? entry.uri : parentUri
  const isSelected = selectedEntryUri === entry.uri
  const isCut = explorerClipboard?.mode === 'cut' && explorerClipboard.entry.uri === entry.uri
  const isDropTarget = dropTargetDirectoryUri === entry.uri && entry.kind === 'directory'
  const isWithinDropTargetScope =
    dropTargetDirectoryUri !== null &&
    dropTargetDirectoryUri !== rootUri &&
    parentUri === dropTargetDirectoryUri
  const className = [
    'workspace-space-explorer__entry',
    isSelected ? 'workspace-space-explorer__entry--selected' : '',
    isCut ? 'workspace-space-explorer__entry--cut' : '',
    isDropTarget ? 'workspace-space-explorer__entry--drop-target' : '',
    isWithinDropTargetScope ? 'workspace-space-explorer__entry--drop-target-scope' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = viewMode === 'list' ? { paddingLeft: `${10 + row.depth * 14}px` } : undefined

  if (renameEntryUri === entry.uri) {
    return (
      <form
        className="workspace-space-explorer__rename"
        style={style}
        onSubmit={event => {
          event.preventDefault()
          event.stopPropagation()
          onRenameSubmit()
        }}
        onBlur={event => {
          if (
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          ) {
            onRenameCancel()
          }
        }}
      >
        <FileSystemEntryIcon
          path={entry.uri}
          kind={entry.kind === 'directory' ? 'directory' : 'file'}
          className="workspace-space-explorer__entry-icon"
        />
        <input
          ref={renameInputRef}
          className="workspace-space-explorer__rename-input"
          value={renameDraftName}
          aria-label={t('spaceExplorer.rename')}
          onChange={event => onRenameDraftChange(event.target.value)}
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
    <div
      draggable
      tabIndex={-1}
      role={viewMode === 'icons' ? 'option' : 'treeitem'}
      aria-selected={isSelected}
      aria-level={viewMode === 'list' ? row.depth + 1 : undefined}
      aria-expanded={viewMode === 'list' && entry.kind === 'directory' ? row.isExpanded : undefined}
      className={className}
      style={style}
      data-testid={`workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(entry.uri)}`}
      title={decodeUriPathname(entry.uri)}
      onClick={event => {
        event.stopPropagation()
        onCancelPreview()
        if (isExplorerOverlayInteractionSuppressed()) {
          return
        }
        if (entry.kind === 'directory') {
          if (viewMode === 'list') {
            onDirectoryToggle(entry)
          } else {
            onEntryOpen(entry)
          }
        } else {
          onPreview(entry)
        }
      }}
      onDoubleClick={event => {
        event.stopPropagation()
        onCancelPreview()
        if (!isExplorerOverlayInteractionSuppressed()) {
          onEntryOpen(entry)
        }
      }}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        onCancelPreview()
        onEntryContextMenu(entry, { x: event.clientX, y: event.clientY })
      }}
      onDragStart={event => {
        event.stopPropagation()
        onCancelPreview()
        setFilesystemEntryDragData(event.dataTransfer, {
          version: 1,
          uri: entry.uri,
          kind: entry.kind === 'directory' ? 'directory' : 'file',
          rootUri: navigationRootUri,
          mountId,
          sourceSpaceId,
        })
        event.dataTransfer.effectAllowed = 'copyMove'
        onEntryDragStart(entry)
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
        event.dataTransfer.dropEffect = 'move'
        onDropTargetChange(dropDirectoryUri)
      }}
      onDragLeave={event => {
        if (
          !draggedEntryUri ||
          (event.relatedTarget instanceof Element &&
            event.currentTarget.contains(event.relatedTarget))
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
        onRequestDropMove(dropDirectoryUri)
      }}
    >
      {viewMode === 'list' ? (
        entry.kind === 'directory' ? (
          <button
            type="button"
            className="workspace-space-explorer__entry-disclosure"
            data-testid="directory-entry-disclosure"
            aria-label={t(
              row.isExpanded ? 'spaceExplorer.collapseFolder' : 'spaceExplorer.expandFolder',
              { name: entry.name },
            )}
            aria-expanded={row.isExpanded}
            onDoubleClick={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              onCancelPreview()
              if (!isExplorerOverlayInteractionSuppressed()) {
                onDirectoryToggle(entry)
              }
            }}
          >
            {row.isExpanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : (
          <span className="workspace-space-explorer__entry-disclosure-placeholder" />
        )
      ) : null}
      <span className="cove-directory-browser__entry-symbol">
        <FileSystemEntryIcon
          path={entry.uri}
          kind={entry.kind === 'directory' ? 'directory' : 'file'}
          className="workspace-space-explorer__entry-icon"
        />
      </span>
      <span className="workspace-space-explorer__entry-label">{entry.name}</span>
    </div>
  )
}
