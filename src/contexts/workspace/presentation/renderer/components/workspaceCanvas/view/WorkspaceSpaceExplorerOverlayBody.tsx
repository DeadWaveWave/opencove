import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import { WorkspaceSpaceExplorerOverlayHeader } from './WorkspaceSpaceExplorerOverlayHeader'
import type { SpaceExplorerClipboardItem } from './WorkspaceSpaceExplorerOverlay.operations'
import { WorkspaceDirectoryBrowser } from './WorkspaceDirectoryBrowser'
import { isFileUriWithinRoot, resolveFileUriBreadcrumbs } from '@shared/utils/fileUriScope'

type WorkspaceSpaceExplorerOverlayBodyProps = {
  spaceName: string
  spaceId: string
  rootUri: string | null
  requestedDirectory?: { uri: string } | null
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
  onWindowDragStart: React.PointerEventHandler<HTMLElement>
}

function WorkspaceSpaceExplorerOverlayBodyReady(
  props: WorkspaceSpaceExplorerOverlayBodyProps & { rootUri: string },
): React.JSX.Element {
  const { rootUri, requestedDirectory, onDismissQuickPreview } = props
  const [currentUri, setCurrentUri] = React.useState(() =>
    requestedDirectory && isFileUriWithinRoot(rootUri, requestedDirectory.uri)
      ? requestedDirectory.uri
      : rootUri,
  )
  React.useEffect(() => {
    if (requestedDirectory && isFileUriWithinRoot(rootUri, requestedDirectory.uri)) {
      onDismissQuickPreview()
      setCurrentUri(requestedDirectory.uri)
    }
  }, [onDismissQuickPreview, requestedDirectory, rootUri])
  const [viewMode, setViewMode] = React.useState<'icons' | 'list'>('icons')
  const [expandedDirectoryUris, setExpandedDirectoryUris] = React.useState<string[]>([])
  const breadcrumbs = resolveFileUriBreadcrumbs(rootUri, currentUri)
  const title = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 1].name : props.spaceName
  const navigate = React.useCallback(
    (uri: string) => {
      if (isFileUriWithinRoot(rootUri, uri)) {
        onDismissQuickPreview()
        setCurrentUri(uri)
      }
    },
    [rootUri, onDismissQuickPreview],
  )
  return (
    <>
      <WorkspaceSpaceExplorerOverlayHeader
        title={title}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onWindowDragStart={props.onWindowDragStart}
        onClose={props.onClose}
      />
      <WorkspaceDirectoryBrowser
        key={`${props.mountId ?? ''}:${rootUri}`}
        {...props}
        currentUri={currentUri}
        viewMode={viewMode}
        expandedDirectoryUris={expandedDirectoryUris}
        onNavigate={navigate}
        onExpandedDirectoryUrisChange={setExpandedDirectoryUris}
        sourceSpaceId={props.spaceId}
      />
    </>
  )
}

export const WorkspaceSpaceExplorerOverlayBody = React.memo(
  function WorkspaceSpaceExplorerOverlayBody({
    spaceName,
    spaceId,
    rootUri,
    requestedDirectory,
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
    onWindowDragStart,
  }: WorkspaceSpaceExplorerOverlayBodyProps): React.JSX.Element {
    const { t } = useTranslation()

    if (!rootUri) {
      return (
        <>
          <WorkspaceSpaceExplorerOverlayHeader
            title={spaceName}
            viewMode="icons"
            onWindowDragStart={onWindowDragStart}
            onClose={onClose}
          />
          <div className="workspace-space-explorer__state">{t('common.loading')}</div>
        </>
      )
    }

    return (
      <WorkspaceSpaceExplorerOverlayBodyReady
        key={`${spaceId}:${mountId ?? ''}:${rootUri}`}
        spaceName={spaceName}
        spaceId={spaceId}
        rootUri={rootUri}
        requestedDirectory={requestedDirectory}
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
        onWindowDragStart={onWindowDragStart}
      />
    )
  },
)

WorkspaceSpaceExplorerOverlayBody.displayName = 'WorkspaceSpaceExplorerOverlayBody'
