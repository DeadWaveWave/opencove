import React, { useEffect, useMemo, useState } from 'react'
import { ViewportPortal, type Node } from '@xyflow/react'
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
      <span className="workspace-far-tile__icon">
        <NodeKindIcon kind={provider ? 'agent' : kind} pluginId={pluginId ?? undefined} />
      </span>
      <span className="workspace-far-tile__title">{title}</span>
      {signal ? <span className="workspace-far-tile__signal" data-signal={signal} /> : null}
    </div>
  )
})

/** Tiles and windows cross-fade over this long; reduced motion switches at once. */
export const FAR_VIEW_FADE_MS = 140

/** Keeps the tiles for one fade after the canvas returns to near view, so they fade out. */
function useFarViewExit(lod: 'near' | 'far'): boolean {
  const [leaving, setLeaving] = useState(false)
  const [previous, setPrevious] = useState(lod)
  if (previous !== lod) {
    setPrevious(lod)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    setLeaving(lod === 'near' && !reducedMotion)
  }
  useEffect(() => {
    if (!leaving) {
      return undefined
    }
    const timer = window.setTimeout(() => setLeaving(false), FAR_VIEW_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])
  return leaving
}

/**
 * Far view (Tide phase 4): below 25% zoom every expanded window is drawn as one tile, as in the
 * Tide prototype: a kind-coloured wash with a large pixel glyph, a bold title and a status pixel,
 * in a single layer above the windows. Windows stay mounted at their
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
  const leaving = useFarViewExit(lod)
  const shown = lod === 'far' || leaving
  const tiles = useMemo(() => (shown ? buildFarTiles(nodes) : []), [shown, nodes])
  if (!shown) {
    return null
  }
  return (
    <ViewportPortal>
      <div
        className="workspace-far-view"
        data-testid="workspace-far-view"
        data-leaving={leaving || undefined}
        aria-hidden="true"
      >
        {tiles.map(tile => (
          <FarTileView key={tile.id} {...tile} />
        ))}
      </div>
    </ViewportPortal>
  )
})
