import type { ReactElement } from 'react'
import { WebsiteNode } from '../WebsiteNode'
import type { Point, TerminalNodeData } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import type { BrowserMode } from '@shared/contracts/dto'
import type { BrowserSearchEngineId } from '@contexts/settings/domain/browserSettings'
import { useCanvasNodeCommands } from './nodeTypes.context'

export function WorkspaceCanvasWebsiteNodeType({
  data,
  id,
  nodePosition,
  browserDefaultMode,
  browserSearchEngine,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: Point
  browserDefaultMode: BrowserMode
  browserSearchEngine: BrowserSearchEngineId
}): ReactElement | null {
  const { window: windowCommands, website } = useCanvasNodeCommands()
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
        void windowCommands.close(id)
      }}
      onResize={frame => windowCommands.resize(id, frame)}
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            windowCommands.select(id, { toggle: true })
            return
          }

          windowCommands.select(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        windowCommands.focusForInteraction(id)
      }}
      onUrlCommit={nextUrl => {
        website.updateUrl(id, nextUrl)
      }}
      onPinnedChange={nextPinned => {
        website.setPinned(id, nextPinned)
      }}
      onSessionChange={(nextMode, nextProfileId) => {
        website.setSession(id, nextMode, nextProfileId)
      }}
      onModeChange={nextMode => {
        website.setMode(id, nextMode)
      }}
      onFullscreenChange={(frame, previousFrame, isFullscreen) => {
        website.setFullscreen(id, frame, previousFrame, isFullscreen)
      }}
    />
  )
}
