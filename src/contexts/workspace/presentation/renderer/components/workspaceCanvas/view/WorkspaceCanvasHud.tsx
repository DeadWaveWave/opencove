import React, { memo, useEffect, useState, type RefObject } from 'react'
import { useReactFlow, useStore, type ReactFlowState } from '@xyflow/react'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import { Surface } from '@app/renderer/components/ui/Surface'
import { useTranslation } from '@app/renderer/i18n'
import type { CanvasLod } from './canvasLod'
import { useCanvasLod } from './useCanvasLod'

/** 「远景」 fits everything at this zoom or closer, safely inside far view. */
const FAR_FIT_ZOOM = 0.2
const LOD_TRANSITION_MS = 320

const zoomOf = (state: ReactFlowState) => state.transform[2]

/** Only this chip follows each zoom step; the rest of the HUD changes with the level. */
const ZoomChip = memo(function ZoomChip(): React.JSX.Element {
  const { t } = useTranslation()
  const percent = Math.round(useStore(zoomOf) * 100)
  return (
    <Surface
      material="acrylic"
      className="workspace-canvas-hud__zoom"
      data-testid="workspace-canvas-hud-zoom"
      aria-label={t('canvasHud.zoom', { percent })}
    >
      {percent}%
    </Surface>
  )
})

/**
 * The canvas HUD (Tide): a switch between far and near view at the top left and the zoom at the
 * top right. 「远景」 fits every window in far view; 「近景」 returns to 100% around the centre.
 */
export const WorkspaceCanvasHud = memo(function WorkspaceCanvasHud({
  canvasRef,
  farViewEnabled,
}: {
  canvasRef: RefObject<HTMLDivElement | null>
  farViewEnabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const reactFlow = useReactFlow()
  const lod = useCanvasLod(canvasRef)
  // The level changes when the zoom crosses it; show the choice at once until then.
  const [pending, setPending] = useState<CanvasLod | null>(null)
  useEffect(() => {
    if (pending === null) {
      return
    }
    if (pending === lod) {
      setPending(null)
      return
    }
    const timer = window.setTimeout(() => setPending(null), LOD_TRANSITION_MS * 2)
    return () => window.clearTimeout(timer)
  }, [lod, pending])
  const choose = (next: CanvasLod) => {
    setPending(next)
    if (next === 'far') {
      void reactFlow.fitView({ maxZoom: FAR_FIT_ZOOM, duration: LOD_TRANSITION_MS })
    } else {
      void reactFlow.zoomTo(1, { duration: LOD_TRANSITION_MS })
    }
  }
  return (
    <div className="workspace-canvas-hud" data-testid="workspace-canvas-hud">
      {farViewEnabled ? (
        <Surface material="acrylic" className="workspace-canvas-hud__lod nodrag nopan">
          <SegmentedControl
            testId="workspace-canvas-hud-lod"
            label={t('canvasHud.view')}
            value={pending ?? lod}
            onValueChange={choose}
            options={[
              { value: 'far', label: t('canvasHud.far'), testId: 'workspace-canvas-hud-lod-far' },
              {
                value: 'near',
                label: t('canvasHud.near'),
                testId: 'workspace-canvas-hud-lod-near',
              },
            ]}
          />
        </Surface>
      ) : (
        <span />
      )}
      <ZoomChip />
    </div>
  )
})
