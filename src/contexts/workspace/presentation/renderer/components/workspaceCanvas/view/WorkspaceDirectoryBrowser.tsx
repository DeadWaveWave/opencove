import React from 'react'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import { useWorkspaceSpaceExplorerOverlayKeyboard } from './WorkspaceSpaceExplorerOverlay.keyboard'
import { useSpaceExplorerOverlayModel } from './WorkspaceSpaceExplorerOverlay.model'
import type { SpaceExplorerClipboardItem } from './WorkspaceSpaceExplorerOverlay.operations'
import { WorkspaceSpaceExplorerOverlayContextMenu } from './WorkspaceSpaceExplorerOverlayContextMenu'
import { WorkspaceDirectoryBrowserNavigation } from './WorkspaceDirectoryBrowserNavigation'
import { WorkspaceSpaceExplorerOverlayToolbar } from './WorkspaceSpaceExplorerOverlayToolbar'
import { WorkspaceSpaceExplorerOverlayWindows } from './WorkspaceSpaceExplorerOverlayWindows'
import { WorkspaceSpaceExplorerTree } from './WorkspaceSpaceExplorerOverlay.tree'

export interface WorkspaceDirectoryBrowserProps {
  spaceId: string
  sourceSpaceId: string | null
  rootUri: string
  currentUri: string
  viewMode: 'icons' | 'list'
  expandedDirectoryUris: string[]
  onNavigate: (uri: string) => void
  onExpandedDirectoryUrisChange: (uris: string[]) => void
  mountId: string | null
  rootResolveError: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  onPreviewFile: (uri: string) => void
  onOpenFile: (uri: string) => void
  onDismissQuickPreview: () => void
  onClose: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  createInputRef: React.RefObject<HTMLInputElement | null>
  renameInputRef: React.RefObject<HTMLInputElement | null>
  containerRef: React.RefObject<HTMLElement | null>
}

export function WorkspaceDirectoryBrowser({
  spaceId,
  rootUri,
  currentUri,
  viewMode,
  expandedDirectoryUris,
  onNavigate,
  onExpandedDirectoryUrisChange,
  sourceSpaceId,
  mountId,
  rootResolveError,
  explorerClipboard,
  setExplorerClipboard,
  findBlockingOpenDocument,
  onPreviewFile,
  onOpenFile,
  onDismissQuickPreview,
  onClose,
  onShowMessage,
  createInputRef,
  renameInputRef,
  containerRef,
}: WorkspaceDirectoryBrowserProps): React.JSX.Element {
  const model = useSpaceExplorerOverlayModel({
    rootUri: currentUri,
    navigationRootUri: rootUri,
    viewMode,
    expandedUris: expandedDirectoryUris,
    onExpandedUrisChange: onExpandedDirectoryUrisChange,
    onNavigate,
    mountId,
    spaceId,
    explorerClipboard,
    setExplorerClipboard,
    findBlockingOpenDocument,
    onPreviewFile,
    onOpenFile,
    onDismissQuickPreview,
    onShowMessage,
  })
  const effectiveRootError = rootResolveError ?? model.rootError
  const hasRootError = !!effectiveRootError
  const explorerContextMenu = model.contextMenu
  const closeExplorerContextMenu = model.closeContextMenu
  const filterInputRef = React.useRef<HTMLInputElement | null>(null)

  const focusFilterInput = React.useCallback(() => {
    filterInputRef.current?.focus()
    filterInputRef.current?.select()
  }, [])

  const openKeyboardContextMenu = React.useCallback(() => {
    const selectedSelector =
      model.selectedEntryUri !== null
        ? `[data-testid="workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(model.selectedEntryUri)}"]`
        : null
    const selectedElement =
      selectedSelector && containerRef.current
        ? (containerRef.current.querySelector(selectedSelector) as HTMLElement | null)
        : null

    if (selectedElement) {
      const bounds = selectedElement.getBoundingClientRect()
      const entryRow = model.rows.find(
        row => row.kind === 'entry' && row.entry.uri === model.selectedEntryUri,
      )
      if (entryRow && entryRow.kind === 'entry') {
        model.openEntryContextMenu(entryRow.entry, {
          x: bounds.left + 12,
          y: bounds.top + Math.min(bounds.height - 8, 18),
        })
        return
      }
    }

    const tree = containerRef.current?.querySelector(
      '[data-testid="workspace-space-explorer-tree"]',
    ) as HTMLElement | null
    const bounds = tree?.getBoundingClientRect()
    model.openRootContextMenu({
      x: bounds ? bounds.left + 20 : 32,
      y: bounds ? bounds.top + 20 : 32,
    })
  }, [containerRef, model, spaceId])

  React.useEffect(() => {
    if (!model.create.mode) {
      return
    }

    const handle = window.setTimeout(() => {
      createInputRef.current?.focus()
      createInputRef.current?.select()
      createInputRef.current?.scrollIntoView?.({ block: 'nearest' })
    }, 0)

    return () => {
      window.clearTimeout(handle)
    }
  }, [createInputRef, model.create.mode, model.create.targetDirectoryUri])

  React.useEffect(() => {
    if (!model.rename.entryUri) {
      return
    }

    const handle = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)

    return () => {
      window.clearTimeout(handle)
    }
  }, [model.rename.entryUri, renameInputRef])

  React.useEffect(() => {
    if (!explorerContextMenu) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.workspace-space-explorer__context-menu')
      ) {
        return
      }

      closeExplorerContextMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [closeExplorerContextMenu, explorerContextMenu])

  useWorkspaceSpaceExplorerOverlayKeyboard({
    rootRef: containerRef,
    contextMenu: model.contextMenu,
    dismissTransientUi: model.dismissTransientUi,
    moveSelection: model.moveSelection,
    collapseSelectionOrFocusParent: model.collapseSelectionOrFocusParent,
    expandSelectionOrOpen: model.expandSelectionOrOpen,
    openSelection: model.openSelection,
    requestDeleteSelection: model.requestDeleteSelection,
    copySelection: model.copySelection,
    cutSelection: model.cutSelection,
    copyPath: model.copyPath,
    canUndoMove: model.canUndoMove,
    canRedoMove: model.canRedoMove,
    undoMove: model.undoMove,
    redoMove: model.redoMove,
    pasteIntoSelectionTarget: model.pasteIntoSelectionTarget,
    startRenameSelection: model.startRenameSelection,
    focusFilterInput,
    openKeyboardContextMenu,
    onClose,
  })

  return (
    <>
      <div
        className="workspace-space-explorer__body cove-directory-browser nodrag"
        data-cove-part="window-body"
        data-cove-focus-scope="file-browser"
      >
        <WorkspaceSpaceExplorerOverlayToolbar
          viewMode={viewMode}
          query={model.filter.query}
          inputRef={filterInputRef}
          hasRootError={hasRootError}
          onQueryChange={model.filter.setQuery}
          onClearQuery={model.filter.clear}
          onCreateFile={() => model.create.start('file')}
          onCreateFolder={() => model.create.start('directory')}
          onCollapseAll={model.collapseAll}
          onRefresh={model.refresh}
        />

        <WorkspaceSpaceExplorerTree
          spaceId={spaceId}
          rootUri={currentUri}
          navigationRootUri={rootUri}
          mountId={mountId}
          sourceSpaceId={sourceSpaceId}
          viewMode={viewMode}
          isLoadingRoot={model.isLoadingRoot}
          rootError={effectiveRootError}
          rows={model.rows}
          isFilterActive={model.filter.isActive}
          createMode={model.create.mode}
          createTargetDirectoryUri={model.create.targetDirectoryUri}
          createDraftName={model.create.draftName}
          createError={model.create.error}
          createIsCreating={model.create.isCreating}
          createInputRef={createInputRef}
          selectedEntryUri={model.selectedEntryUri}
          renameEntryUri={model.rename.entryUri}
          renameDraftName={model.rename.draftName}
          renameError={model.rename.error}
          renameInputRef={renameInputRef}
          draggedEntryUri={model.draggedEntryUri}
          dropTargetDirectoryUri={model.dropTargetDirectoryUri}
          explorerClipboard={explorerClipboard}
          onRefresh={model.refresh}
          onRootContextMenu={model.openRootContextMenu}
          onEntrySelect={model.selectEntry}
          onEntryPreview={model.previewEntrySelection}
          onEntryOpen={model.openEntry}
          onDirectoryToggle={model.previewEntrySelection}
          onEntryContextMenu={model.openEntryContextMenu}
          onCreateDraftChange={model.create.setDraftName}
          onCreateSubmit={model.create.submit}
          onCreateCancel={model.create.cancel}
          onRenameDraftChange={model.rename.setDraftName}
          onRenameSubmit={model.rename.submit}
          onRenameCancel={model.rename.cancel}
          onEntryDragStart={model.handleEntryDragStart}
          onEntryDragEnd={model.handleEntryDragEnd}
          onDropTargetChange={model.handleDropTargetChange}
          onRequestDropMove={model.requestDropMove}
        />
        <WorkspaceDirectoryBrowserNavigation
          rootUri={rootUri}
          currentUri={currentUri}
          onNavigate={onNavigate}
          onShowMessage={onShowMessage}
        />
      </div>

      <WorkspaceSpaceExplorerOverlayContextMenu
        menu={model.contextMenu}
        canPaste={explorerClipboard !== null}
        onClose={model.closeContextMenu}
        onOpen={model.openSelection}
        onNewFile={() => {
          model.create.start('file')
        }}
        onNewFolder={() => {
          model.create.start('directory')
        }}
        onRename={model.startRenameSelection}
        onCut={model.cutSelection}
        onCopy={model.copySelection}
        onPaste={() => {
          void model.pasteIntoSelectionTarget()
        }}
        onCopyPath={() => {
          void model.copyPath()
        }}
        onCopyRelativePath={() => {
          void model.copyRelativePath()
        }}
        onRefresh={() => {
          model.closeContextMenu()
          model.refresh()
        }}
        onDelete={model.requestDeleteSelection}
      />

      <WorkspaceSpaceExplorerOverlayWindows
        deleteConfirmation={model.deleteConfirmation}
        onCancelDelete={model.cancelDelete}
        onConfirmDelete={() => {
          void model.confirmDelete()
        }}
      />
    </>
  )
}
