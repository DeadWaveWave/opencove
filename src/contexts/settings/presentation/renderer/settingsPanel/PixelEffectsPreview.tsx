import { useEffect, useRef, useState } from 'react'
import { FileText, GitBranch, Play, Terminal } from 'lucide-react'
import { Button } from '@app/renderer/components/ui/Button'
import { useTranslation } from '@app/renderer/i18n'
import type { PixelEffectSettings } from '@contexts/settings/domain/agentSettings'
import { createPixelEffectPreview, type PixelEffectPreviewState } from './pixelEffectPreview'

export function PixelEffectsPreview({ effects }: { effects: PixelEffectSettings }) {
  const { t } = useTranslation()
  const scopeRef = useRef<HTMLDivElement>(null)
  const nodeRef = useRef<HTMLDivElement>(null)
  const backgroundRef = useRef<HTMLCanvasElement>(null)
  const foregroundRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<ReturnType<typeof createPixelEffectPreview> | null>(null)
  const [state, setState] = useState<PixelEffectPreviewState>({
    playing: false,
    reducedMotion: false,
  })
  const [hasPlayed, setHasPlayed] = useState(false)
  useEffect(() => {
    const scope = scopeRef.current
    const node = nodeRef.current
    const background = backgroundRef.current
    const foreground = foregroundRef.current
    if (!scope || !node || !background || !foreground) {
      return
    }
    controllerRef.current = createPixelEffectPreview(
      { scope, node, background, foreground },
      {
        canvasPixelBackgroundEnabled: effects.canvasPixelBackgroundEnabled,
        nodeCreationPixelEffectEnabled: effects.nodeCreationPixelEffectEnabled,
        nodeClosePixelEffectEnabled: effects.nodeClosePixelEffectEnabled,
        agentWorkingPixelEffectEnabled: effects.agentWorkingPixelEffectEnabled,
      },
      setState,
    )
    return () => {
      controllerRef.current?.dispose()
      controllerRef.current = null
    }
  }, [
    effects.canvasPixelBackgroundEnabled,
    effects.nodeCreationPixelEffectEnabled,
    effects.nodeClosePixelEffectEnabled,
    effects.agentWorkingPixelEffectEnabled,
  ])
  return (
    <div className="settings-pixel-preview-group">
      <div className="settings-pixel-preview-toolbar">
        <span className="settings-pixel-preview-status" role="status" aria-live="polite">
          {hasPlayed && !state.playing
            ? t(
                state.reducedMotion
                  ? 'settingsPanel.appearanceNext.previewReducedMotion'
                  : 'settingsPanel.appearanceNext.previewComplete',
              )
            : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="settings-pixel-effects-replay"
          disabled={state.playing}
          onClick={() => {
            setHasPlayed(true)
            controllerRef.current?.replay()
          }}
        >
          <Play size={14} aria-hidden="true" />
          {t('settingsPanel.appearanceNext.replay')}
        </Button>
      </div>
      <div
        ref={scopeRef}
        className="settings-pixel-preview"
        data-testid="settings-pixel-effects-preview"
        data-background={effects.canvasPixelBackgroundEnabled}
        data-playing={state.playing}
        data-reduced-motion={state.reducedMotion}
        role="img"
        aria-label={t('settingsPanel.appearanceNext.preview')}
      >
        <canvas
          ref={backgroundRef}
          className="settings-pixel-preview__canvas"
          hidden={!effects.canvasPixelBackgroundEnabled && !effects.agentWorkingPixelEffectEnabled}
          aria-hidden="true"
        />
        <fieldset
          className="settings-pixel-preview__space"
          data-cove-part="space"
          aria-hidden="true"
        >
          <legend>
            <strong>{t('settingsPanel.appearanceNext.previewSpace')}</strong>
            <GitBranch size={13} />
            ui/chrome
          </legend>
          <div className="settings-pixel-preview__nodes">
            <div className="settings-pixel-preview__node" data-cove-part="window">
              <div className="settings-pixel-preview__header" data-cove-part="window-header">
                <FileText size={14} />
                {t('settingsPanel.appearanceNext.previewDocument')}
              </div>
              <div className="settings-pixel-preview__body" data-cove-part="window-body">
                {t('settingsPanel.appearanceNext.previewDocumentBody')}
              </div>
            </div>
            <div
              ref={nodeRef}
              className="settings-pixel-preview__node settings-pixel-preview__node--terminal"
              data-cove-part="window"
              data-id="settings-preview-terminal"
            >
              <div className="settings-pixel-preview__header" data-cove-part="window-header">
                <Terminal size={14} />
                {t('settingsPanel.appearanceNext.previewTerminal')}
              </div>
              <div className="settings-pixel-preview__body" data-cove-part="window-body">
                <code>
                  ~/projects/cove
                  <br />
                  <b>❯</b> pnpm dev
                </code>
              </div>
            </div>
          </div>
        </fieldset>
        <canvas
          ref={foregroundRef}
          className="settings-pixel-preview__canvas settings-pixel-preview__canvas--foreground"
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
