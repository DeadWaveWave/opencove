import {
  CloseIcon,
  MinusIcon,
  StopIcon,
  TerminalIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import '@app/renderer/styles/settings-panel.terminal-preview.css'

export function TerminalTypographyPreview({
  fontFamily,
  fontSize,
}: {
  fontFamily: string | null
  fontSize: number
}) {
  const { t } = useTranslation()
  return (
    <div className="settings-terminal-preview-stage">
      <div
        className="settings-terminal-preview"
        data-testid="settings-terminal-typography-preview"
        role="img"
        aria-label={t('settingsPanel.appearanceNext.terminalPreview')}
      >
        <div className="settings-terminal-preview__header" aria-hidden="true">
          <TerminalIcon size={18} />
          <span>Terminal</span>
          <code>~/opencove</code>
          <div className="settings-terminal-preview__chrome">
            <MinusIcon size={12} />
            <StopIcon size={12} />
            <CloseIcon size={12} />
          </div>
        </div>
        <div
          className="settings-terminal-preview__content"
          data-testid="settings-terminal-typography-content"
          style={{ fontFamily: fontFamily ?? 'var(--cove-font-mono)', fontSize }}
          aria-hidden="true"
        >
          <div>
            <span className="settings-terminal-preview__prompt">❯</span> pnpm dev
          </div>
          <div>
            <span className="settings-terminal-preview__success">VITE</span> ready in 184 ms
          </div>
          <div>Local: http://localhost:3000/</div>
          <div className="settings-terminal-preview__input">
            <span className="settings-terminal-preview__prompt">❯</span>
            <span className="settings-terminal-preview__cursor" />
          </div>
        </div>
      </div>
    </div>
  )
}
