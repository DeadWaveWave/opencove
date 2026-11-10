import React, { memo, useMemo } from 'react'
import { ArrowRightIcon, RobotIcon } from '@app/renderer/components/ui/pixelIcons'
import { useReactFlow, useStore, type Node, type ReactFlowState } from '@xyflow/react'
import { Button } from '@app/renderer/components/ui/Button'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData } from '../../../types'
import { agentAttentionLabelKey } from '../../../utils/agentAttentionLabel'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { focusNodeInViewport } from '../helpers'
import { showWindowFocus } from './windowSignals/windowFocus'
import { resolveEdgeBeacons, type EdgeBeaconSide } from './edgeBeacons'

/** How far beacons sit inside the canvas edges, in px: room for the pill's half width. */
const INSET = { x: 132, y: 28 }
const ARROW_ROTATION: Record<EdgeBeaconSide, number> = { right: 0, bottom: 90, left: 180, top: -90 }

type View = { x: number; y: number; zoom: number; width: number; height: number }

function sameView(left: View | null, right: View | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.x === right.x &&
      left.y === right.y &&
      left.zoom === right.zoom &&
      left.width === right.width &&
      left.height === right.height)
  )
}

/**
 * Viewport edge beacons (Tide EdgeBeacon): a titled pill for each window waiting for you that
 * is out of view, five at most and the rest as "+N"; a click flies to it. Derived from agent
 * state and the viewport, never stored. With no waiting windows it does not follow the view.
 */
export const WorkspaceEdgeBeacons = memo(function WorkspaceEdgeBeacons({
  nodes,
  canvasRef,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  nodes: Node<TerminalNodeData>[]
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const reactFlow = useReactFlow<Node<TerminalNodeData>>()
  const waiting = useMemo(
    () => nodes.filter(node => resolveAgentPresentation(node.data).status === 'waiting'),
    [nodes],
  )
  const hasWaiting = waiting.length > 0
  const view = useStore(
    (state: ReactFlowState) =>
      hasWaiting
        ? {
            x: state.transform[0],
            y: state.transform[1],
            zoom: state.transform[2],
            width: state.width,
            height: state.height,
          }
        : null,
    sameView,
  )
  if (!view || view.width <= 0 || view.height <= 0) {
    return null
  }
  const statusById = new Map(
    waiting.map(node => [
      node.id,
      t(
        agentAttentionLabelKey({
          blockedReason: resolveAgentPresentation(node.data).observation?.blockedReason,
        }),
      ),
    ]),
  )
  const { beacons, overflow } = resolveEdgeBeacons(
    waiting.map(node => ({
      id: node.id,
      title: node.data.title || t('sidebar.fallbackAgentLabel'),
      rect: {
        x: node.position.x * view.zoom + view.x,
        y: node.position.y * view.zoom + view.y,
        width: (node.measured?.width ?? node.width ?? node.data.width) * view.zoom,
        height: (node.measured?.height ?? node.height ?? node.data.height) * view.zoom,
      },
    })),
    view,
    INSET,
  )
  if (beacons.length === 0 && !overflow) {
    return null
  }
  const flyTo = (id: string) => {
    const node = waiting.find(candidate => candidate.id === id)
    if (node) {
      focusNodeInViewport(reactFlow, node, { zoom: Math.max(view.zoom, 0.6), duration: 320 })
      if (canvasRef.current) {
        showWindowFocus(canvasRef.current, node.id)
      }
    }
  }
  return (
    <div className="workspace-edge-beacons" role="group" aria-label={t('edgeBeacons.label')}>
      {beacons.map(beacon => (
        <Button
          key={beacon.id}
          variant="ghost"
          size="sm"
          className="workspace-edge-beacon nodrag nopan"
          data-testid={`workspace-edge-beacon-${beacon.id}`}
          data-side={beacon.side}
          style={{ left: beacon.x, top: beacon.y }}
          aria-label={t('edgeBeacons.go', {
            title: beacon.title,
            status: statusById.get(beacon.id),
          })}
          onClick={() => flyTo(beacon.id)}
        >
          <span className="workspace-edge-beacon__dot" aria-hidden="true" />
          <KindTile kind="ai" size="sm">
            <RobotIcon />
          </KindTile>
          <span className="workspace-edge-beacon__title">{beacon.title}</span>
          <span className="workspace-edge-beacon__status">· {statusById.get(beacon.id)}</span>
          <ArrowRightIcon
            className="workspace-edge-beacon__arrow"
            size={18}
            style={{ transform: `rotate(${ARROW_ROTATION[beacon.side]}deg)` }}
          />
        </Button>
      ))}
      {overflow ? (
        <Button
          variant="ghost"
          size="sm"
          className="workspace-edge-beacon workspace-edge-beacon--more nodrag nopan"
          data-testid="workspace-edge-beacon-more"
          data-side={overflow.side}
          style={{ left: overflow.x, top: overflow.y }}
          aria-label={t('edgeBeacons.goMore', { count: overflow.count })}
          onClick={() => flyTo(overflow.ids[0]!)}
        >
          {t('edgeBeacons.more', { count: overflow.count })}
        </Button>
      ) : null}
    </div>
  )
})
