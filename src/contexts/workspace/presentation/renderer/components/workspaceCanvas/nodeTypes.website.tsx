import type { MutableRefObject, ReactElement } from 'react'
import { WebsiteNode } from '../WebsiteNode'
import type { NodeFrame, Point, TerminalNodeData } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'

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
    />
  )
}
