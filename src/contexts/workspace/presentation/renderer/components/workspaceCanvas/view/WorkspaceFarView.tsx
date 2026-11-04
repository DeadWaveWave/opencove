import React, { useMemo } from 'react'
import { ViewportPortal, type Node } from '@xyflow/react'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { KindTile } from '@app/renderer/components/ui/KindTile'
import type { TerminalNodeData } from '../../../types'
import { NodeKindIcon } from '../../shared/NodeKindIcon'
import { buildFarTiles, type FarTile } from './farTiles'
import { useCanvasLod } from './useCanvasLod'

const FarTileView = React.memo(function FarTileView({
  id,
  kind,
  family,
  title,
  signal,
  labelColor,
  selected,
  provider,
  pluginId,
  filePath,
  x,
  y,
  width,
  height,
}: FarTile): React.JSX.Element {
  return (
    <div
      className="workspace-far-tile"
      data-testid={`workspace-far-tile-${id}`}
      data-cove-kind={family}
      data-cove-label-color={labelColor ?? undefined}
      data-selected={selected || undefined}
      style={{ transform: `translate(${x}px, ${y}px)`, width, height }}
    >
      <KindTile kind={family} className="workspace-far-tile__kind">
        {provider ? (
          <AgentProviderIcon provider={provider} />
        ) : (
          <NodeKindIcon
            kind={kind}
            pluginId={pluginId ?? undefined}
            filePath={filePath ?? undefined}
          />
        )}
      </KindTile>
      <span className="workspace-far-tile__title">{title}</span>
      {signal ? <span className="workspace-far-tile__signal" data-signal={signal} /> : null}
    </div>
  )
})

/**
 * Far view (Tide phase 4): below 25% zoom every expanded window is drawn as one glass tile with
 * its kind, title and status, in a single layer above the windows. Windows stay mounted at their
 * size with their content skipped by CSS, so terminals, editors and pages keep running and keep
 * every pointer interaction; the tiles never take pointer events.
 */
export const WorkspaceFarView = React.memo(function WorkspaceFarView({
  canvasRef,
  nodes,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  nodes: Node<TerminalNodeData>[]
}): React.JSX.Element | null {
  const lod = useCanvasLod(canvasRef)
  const tiles = useMemo(() => (lod === 'far' ? buildFarTiles(nodes) : []), [lod, nodes])
  if (lod !== 'far') {
    return null
  }
  return (
    <ViewportPortal>
      <div className="workspace-far-view" data-testid="workspace-far-view" aria-hidden="true">
        {tiles.map(tile => (
          <FarTileView key={tile.id} {...tile} />
        ))}
      </div>
    </ViewportPortal>
  )
})
