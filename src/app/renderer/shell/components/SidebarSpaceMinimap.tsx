import React from 'react'
import { Tooltip } from '@app/renderer/components/ui/Tooltip'
import type { SpaceMinimapModel } from '../utils/spaceMinimap'

/**
 * A live pixel map of one Space: windows in their kind colour, working ones stepping, waiting
 * ones amber. A pointer shortcut only; the Space name and agent rows carry keyboard and screen
 * reader navigation, so the map stays out of the accessibility tree.
 */
export function SidebarSpaceMinimap({
  model,
  testId,
  onSelectWindow,
  onSelectSpace,
}: {
  model: SpaceMinimapModel
  testId: string
  onSelectWindow: (nodeId: string) => void
  onSelectSpace: () => void
}): React.JSX.Element {
  return (
    <div
      className="workspace-space-minimap"
      data-testid={testId}
      aria-hidden="true"
      style={{ aspectRatio: model.aspectRatio }}
      onClick={event => {
        const nodeId = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset
          .nodeId
        if (nodeId) {
          onSelectWindow(nodeId)
          return
        }
        onSelectSpace()
      }}
    >
      {model.windows.map(window => (
        <Tooltip key={window.nodeId} content={window.title} describe={false}>
          <span
            className="workspace-space-minimap__window"
            data-node-id={window.nodeId}
            data-family={window.family}
            data-status={window.status ?? undefined}
            style={{
              left: `${window.left * 100}%`,
              top: `${window.top * 100}%`,
              width: `${window.width * 100}%`,
              height: `${window.height * 100}%`,
            }}
          />
        </Tooltip>
      ))}
    </div>
  )
}
