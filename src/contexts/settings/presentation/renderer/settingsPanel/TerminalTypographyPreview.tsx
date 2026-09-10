import { Minus, Square, Terminal, X } from 'lucide-react'
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
          <Terminal size={14} />
          <span>Terminal</span>
          <code>~/opencove</code>
          <div className="settings-terminal-preview__chrome">
            <Minus size={12} />
            <Square size={10} />
            <X size={13} />
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
