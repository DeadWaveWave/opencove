import React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { LabelColor } from '@shared/types/labelColor'
import { isFileUriWithinRoot } from '@shared/utils/fileUriScope'
import type { FolderNodeData, NodeFrame, Point } from '../types'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import type { DocumentNodeInteractionOptions } from './DocumentNode.helpers'
import { decodeUriPathname } from './DocumentNode.helpers'
import { NodeKindIcon } from './shared/NodeKindIcon'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { WindowCollapseButton } from './shared/WindowCollapseButton'
import { WorkspaceDirectoryBrowser } from './workspaceCanvas/view/WorkspaceDirectoryBrowser'
import { WorkspaceDirectoryViewMode } from './workspaceCanvas/view/WorkspaceDirectoryViewMode'
import type { SpaceExplorerClipboardItem } from './workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.operations'
import type { SpaceExplorerOpenDocumentBlock } from './workspaceCanvas/hooks/useSpaceExplorer.guards'
import type { ShowWorkspaceCanvasMessage } from './workspaceCanvas/types'

export interface FolderNodeProps {
  id: string
  title: string
  folder: FolderNodeData
  mountId: string | null | undefined
  labelColor?: LabelColor | null
  position: Point
  width: number
  height: number
  onFolderChange: (next: FolderNodeData) => void
  onOpenFile: (uri: string) => void
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onInteractionStart?: (options?: DocumentNodeInteractionOptions) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  onShowMessage?: ShowWorkspaceCanvasMessage
}

const dismissPreview = () => undefined

export function FolderNode({
  id,
  title,
  folder,
  mountId,
  labelColor,
  position,
  width,
  height,
  onFolderChange,
  onOpenFile,
  onClose,
  onResize,
  onInteractionStart,
  findBlockingOpenDocument,
  onShowMessage,
}: FolderNodeProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const createInputRef = React.useRef<HTMLInputElement | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)
  const [explorerClipboard, setExplorerClipboard] =
    React.useState<SpaceExplorerClipboardItem | null>(null)
  const latestFolder = React.useRef(folder)
  latestFolder.current = folder
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('folder'),
    onResize,
  })
  const frame = draftFrame ?? { position, size: { width, height } }
  const navigate = React.useCallback(
    (uri: string) => {
      const current = latestFolder.current
      if (uri === current.uri || !isFileUriWithinRoot(current.rootUri, uri)) {
        return
      }
      const next = { ...current, uri }
      latestFolder.current = next
      onFolderChange(next)
    },
    [onFolderChange],
  )
  const changeView = React.useCallback(
    (viewMode: FolderNodeData['viewMode']) => {
      const current = latestFolder.current
      if (viewMode === current.viewMode) {
        return
      }
      const next = { ...current, viewMode }
      latestFolder.current = next
      onFolderChange(next)
    },
    [onFolderChange],
  )
  const changeExpanded = React.useCallback(
    (expandedDirectoryUris: string[]) => {
      const current = latestFolder.current
      if (
        expandedDirectoryUris.length === current.expandedDirectoryUris.length &&
        expandedDirectoryUris.every(uri => current.expandedDirectoryUris.includes(uri))
      ) {
        return
      }
      const next = { ...current, expandedDirectoryUris }
      latestFolder.current = next
      onFolderChange(next)
    },
    [onFolderChange],
  )

  return (
    <div
      ref={containerRef}
      className="folder-node nowheel"
      data-cove-part="window"
      data-cove-kind="folder"
      data-cove-focus-scope="file-browser"
      data-testid={`folder-node-${id}`}
      tabIndex={0}
      style={{
        width: frame.size.width,
        height: frame.size.height,
        transform:
          frame.position.x !== position.x || frame.position.y !== position.y
            ? `translate(${frame.position.x - position.x}px, ${frame.position.y - position.y}px)`
            : undefined,
      }}
      onPointerDown={event => {
        if (event.target instanceof Element && event.target.closest('.cove-directory-browser')) {
          event.stopPropagation()
          if (!event.target.closest('input, button, textarea')) {
            containerRef.current?.focus({ preventScroll: true })
          }
        }
      }}
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }
        if (event.target.closest('.cove-directory-browser')) {
          onInteractionStart?.({
            normalizeViewport: false,
            clearSelection: true,
            selectNode: false,
            shiftKey: event.shiftKey,
          })
        } else if (!event.target.closest('.nodrag')) {
          onInteractionStart?.({ shiftKey: event.shiftKey })
        }
      }}
      onWheel={event => event.stopPropagation()}
    >
      <header
        className="document-node__header"
        data-cove-part="window-header"
        data-node-drag-handle="true"
      >
        {labelColor ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={labelColor}
            aria-hidden="true"
          />
        ) : null}
        <NodeKindIcon kind="folder" />
        <span
          className="document-node__title"
          data-cove-part="window-title"
          title={decodeUriPathname(folder.uri)}
        >
          <span className="document-node__title-text">{title}</span>
        </span>
        <div className="document-node__actions nodrag">
          <WindowCollapseButton onClose={onClose} />
          <WorkspaceDirectoryViewMode
            viewMode={folder.viewMode}
            onViewModeChange={changeView}
            disabled={mountId === undefined}
          />
          <button
            type="button"
            className="document-node__close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              onClose()
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      {mountId === undefined ? (
        <div
          className="workspace-space-explorer__state workspace-space-explorer__state--error"
          role="status"
        >
          {t('documentNode.filesystemUnavailable')}
        </div>
      ) : (
        <WorkspaceDirectoryBrowser
          key={`${mountId ?? ''}:${folder.rootUri}`}
          spaceId={id}
          sourceSpaceId={null}
          rootUri={folder.rootUri}
          currentUri={folder.uri}
          viewMode={folder.viewMode}
          expandedDirectoryUris={folder.expandedDirectoryUris}
          onNavigate={navigate}
          onExpandedDirectoryUrisChange={changeExpanded}
          mountId={mountId}
          rootResolveError={null}
          explorerClipboard={explorerClipboard}
          setExplorerClipboard={setExplorerClipboard}
          findBlockingOpenDocument={findBlockingOpenDocument}
          onPreviewFile={onOpenFile}
          onOpenFile={onOpenFile}
          onDismissQuickPreview={dismissPreview}
          onClose={dismissPreview}
          onShowMessage={onShowMessage}
          createInputRef={createInputRef}
          renameInputRef={renameInputRef}
          containerRef={containerRef}
        />
      )}
      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="folder-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
