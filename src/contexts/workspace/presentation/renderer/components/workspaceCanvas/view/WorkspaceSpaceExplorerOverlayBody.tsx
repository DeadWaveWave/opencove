import React from 'react'
import { Check, FilePlus, FileText, Folder, FolderPlus, RefreshCw, X } from 'lucide-react'
import { useTranslation, type TranslateFn } from '@app/renderer/i18n'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import { useWorkspaceSpaceExplorerOverlayKeyboard } from './WorkspaceSpaceExplorerOverlay.keyboard'
import {
  useSpaceExplorerOverlayModel,
  type SpaceExplorerCreateMode,
} from './WorkspaceSpaceExplorerOverlay.model'
import type { SpaceExplorerClipboardItem } from './WorkspaceSpaceExplorerOverlay.operations'
import { WorkspaceSpaceExplorerOverlayContextMenu } from './WorkspaceSpaceExplorerOverlayContextMenu'
import { WorkspaceSpaceExplorerOverlayWindows } from './WorkspaceSpaceExplorerOverlayWindows'
import { WorkspaceSpaceExplorerTree } from './WorkspaceSpaceExplorerOverlay.tree'

function resolveCreateIcon(mode: Exclude<SpaceExplorerCreateMode, null>): React.JSX.Element {
  return mode === 'directory' ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />
}

type WorkspaceSpaceExplorerOverlayBodyProps = {
  spaceName: string
  spaceId: string
  rootUri: string | null
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

type WorkspaceSpaceExplorerOverlayBodyReadyProps = Omit<
  WorkspaceSpaceExplorerOverlayBodyProps,
  'rootUri'
> & {
  rootUri: string
  t: TranslateFn
}

function WorkspaceSpaceExplorerOverlayBodyReady({
  t,
  spaceName,
  spaceId,
  rootUri,
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
}: WorkspaceSpaceExplorerOverlayBodyReadyProps): React.JSX.Element {
  const model = useSpaceExplorerOverlayModel({
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
  })
  const effectiveRootError = rootResolveError ?? model.rootError
  const hasRootError = !!effectiveRootError
  const explorerContextMenu = model.contextMenu
  const closeExplorerContextMenu = model.closeContextMenu

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
    }, 0)

    return () => {
      window.clearTimeout(handle)
    }
  }, [createInputRef, model.create.mode])

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
    requestDeleteSelection: model.requestDeleteSelection,
    copySelection: model.copySelection,
    cutSelection: model.cutSelection,
    copyPath: model.copyPath,
    canUndoMove: model.canUndoMove,
    canRedoMove: model.canRedoMove,
    undoMove: model.undoMove,
    redoMove: model.redoMove,
    pasteIntoSelectionTarget: model.pasteIntoSelectionTarget,
    openKeyboardContextMenu,
    onClose,
  })

  return (
    <>
      <header className="workspace-space-explorer__header">
        <div className="workspace-space-explorer__title" title={spaceName}>
          {t('spaceActions.files')}
        </div>
        <div className="workspace-space-explorer__header-actions">
          <button
            type="button"
            className="workspace-space-explorer__header-action"
            aria-label={t('spaceExplorer.newFile')}
            title={t('spaceExplorer.newFile')}
            disabled={hasRootError}
            onClick={event => {
              event.stopPropagation()
              model.create.start('file')
            }}
          >
            <FilePlus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="workspace-space-explorer__header-action"
            aria-label={t('spaceExplorer.newFolder')}
            title={t('spaceExplorer.newFolder')}
            disabled={hasRootError}
            onClick={event => {
              event.stopPropagation()
              model.create.start('directory')
            }}
          >
            <FolderPlus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="workspace-space-explorer__header-action"
            aria-label={t('spaceExplorer.refresh')}
            title={t('spaceExplorer.refresh')}
            onClick={event => {
              event.stopPropagation()
              model.refresh()
            }}
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="workspace-space-explorer__header-action workspace-space-explorer__header-action--close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={event => {
              event.stopPropagation()
              onClose()
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="workspace-space-explorer__body">
        {model.create.mode ? (
          <form
            className="workspace-space-explorer__create"
            onSubmit={event => {
              event.preventDefault()
              event.stopPropagation()
              void model.create.submit()
            }}
            onBlur={event => {
              if (
                model.create.isCreating ||
                (event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget))
              ) {
                return
              }

              model.create.cancel()
            }}
          >
            <span className="workspace-space-explorer__create-icon" aria-hidden="true">
              {resolveCreateIcon(model.create.mode)}
            </span>
            <input
              ref={createInputRef}
              className="workspace-space-explorer__create-input"
              value={model.create.draftName}
              placeholder={
                model.create.mode === 'directory'
                  ? t('spaceExplorer.folderNamePlaceholder')
                  : t('spaceExplorer.fileNamePlaceholder')
              }
              disabled={model.create.isCreating}
              onChange={event => {
                model.create.setDraftName(event.target.value)
              }}
              onKeyDown={event => {
                if (event.key !== 'Escape') {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                if (!model.create.isCreating) {
                  model.create.cancel()
                }
              }}
            />
            <button
              type="submit"
              className="workspace-space-explorer__create-action"
              disabled={model.create.isCreating}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-space-explorer__create-action workspace-space-explorer__create-action--cancel"
              disabled={model.create.isCreating}
              onClick={event => {
                event.stopPropagation()
                model.create.cancel()
              }}
            >
              <X aria-hidden="true" />
            </button>
            {model.create.error ? (
              <div className="workspace-space-explorer__create-error" role="status">
                {model.create.error}
              </div>
            ) : null}
          </form>
        ) : null}

        <WorkspaceSpaceExplorerTree
          spaceId={spaceId}
          rootUri={rootUri}
          isLoadingRoot={model.isLoadingRoot}
          rootError={effectiveRootError}
          rows={model.rows}
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
          onEntryContextMenu={model.openEntryContextMenu}
          onRenameDraftChange={model.rename.setDraftName}
          onRenameSubmit={model.rename.submit}
          onRenameCancel={model.rename.cancel}
          onEntryDragStart={model.handleEntryDragStart}
          onEntryDragEnd={model.handleEntryDragEnd}
          onDropTargetChange={model.handleDropTargetChange}
          onRequestDropMove={model.requestDropMove}
        />
      </div>

      <WorkspaceSpaceExplorerOverlayContextMenu
        menu={model.contextMenu}
        canPaste={explorerClipboard !== null}
        onClose={model.closeContextMenu}
        onOpen={model.expandSelectionOrOpen}
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

export const WorkspaceSpaceExplorerOverlayBody = React.memo(
  function WorkspaceSpaceExplorerOverlayBody({
    spaceName,
    spaceId,
    rootUri,
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
  }: WorkspaceSpaceExplorerOverlayBodyProps): React.JSX.Element {
    const { t } = useTranslation()

    if (!rootUri) {
      return (
        <>
          <header className="workspace-space-explorer__header">
            <div className="workspace-space-explorer__title" title={spaceName}>
              {t('spaceActions.files')}
            </div>
            <div className="workspace-space-explorer__header-actions">
              <button
                type="button"
                className="workspace-space-explorer__header-action workspace-space-explorer__header-action--close"
                aria-label={t('common.close')}
                title={t('common.close')}
                onClick={event => {
                  event.stopPropagation()
                  onClose()
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </header>
          <div className="workspace-space-explorer__state">{t('common.loading')}</div>
        </>
      )
    }

    return (
      <WorkspaceSpaceExplorerOverlayBodyReady
        t={t}
        spaceName={spaceName}
        spaceId={spaceId}
        rootUri={rootUri}
        mountId={mountId}
        rootResolveError={rootResolveError}
        explorerClipboard={explorerClipboard}
        setExplorerClipboard={setExplorerClipboard}
        findBlockingOpenDocument={findBlockingOpenDocument}
        onPreviewFile={onPreviewFile}
        onOpenFile={onOpenFile}
        onDismissQuickPreview={onDismissQuickPreview}
        onClose={onClose}
        onShowMessage={onShowMessage}
        createInputRef={createInputRef}
        renameInputRef={renameInputRef}
        containerRef={containerRef}
      />
    )
  },
)

WorkspaceSpaceExplorerOverlayBody.displayName = 'WorkspaceSpaceExplorerOverlayBody'
