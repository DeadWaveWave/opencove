import type { MutableRefObject, ReactElement } from 'react'
import { WebsiteNode } from '../WebsiteNode'
import type { NodeFrame, Point, TerminalNodeData } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'

export function WorkspaceCanvasWebsiteNodeType({
  data,
  id,
  nodePosition,
  selectNode,
  closeNodeRef,
  resizeNodeRef,
  normalizeViewportForTerminalInteractionRef,
  updateWebsiteUrlRef,
  setWebsitePinnedRef,
  setWebsiteSessionRef,
  setWebsiteModeRef,
  setWebsiteFullscreenRef,
  browserDefaultMode,
  browserSearchEngine,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: Point
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
  updateWebsiteUrlRef: MutableRefObject<(nodeId: string, url: string) => void>
  setWebsitePinnedRef: MutableRefObject<(nodeId: string, pinned: boolean) => void>
  setWebsiteSessionRef: MutableRefObject<
    (nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null) => void
  >
  setWebsiteModeRef: MutableRefObject<(nodeId: string, browserMode: BrowserMode) => void>
  setWebsiteFullscreenRef: MutableRefObject<
    (
      nodeId: string,
      frame: NodeFrame,
      previousFrame: NodeFrame | null,
      isFullscreen: boolean,
    ) => void
  >
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
}): ReactElement | null {
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null

  if (!data.website) {
    return null
  }

  return (
    <WebsiteNode
      nodeId={id}
      title={data.title}
      url={data.website.url}
      pinned={data.website.pinned}
      sessionMode={data.website.sessionMode}
      profileId={data.website.profileId}
      browserMode={data.website.browserMode ?? 'native'}
      browserDefaultMode={browserDefaultMode}
      browserSearchEngine={browserSearchEngine}
      isFullscreen={data.website.isFullscreen === true}
      previousFrame={data.website.previousFrame ?? null}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
      onUrlCommit={nextUrl => {
        updateWebsiteUrlRef.current(id, nextUrl)
      }}
      onPinnedChange={nextPinned => {
        setWebsitePinnedRef.current(id, nextPinned)
      }}
      onSessionChange={(nextMode, nextProfileId) => {
        setWebsiteSessionRef.current(id, nextMode, nextProfileId)
      }}
      onModeChange={nextMode => {
        setWebsiteModeRef.current(id, nextMode)
      }}
      onFullscreenChange={(frame, previousFrame, isFullscreen) => {
        setWebsiteFullscreenRef.current(id, frame, previousFrame, isFullscreen)
      }}
    />
  )
}
