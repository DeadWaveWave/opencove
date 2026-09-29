import { useEffect, useRef, useState, type JSX } from 'react'
import { Copy, Terminal } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { SettingsGroup } from './SettingsGroup'

const GUIDE_COMMAND = 'opencove plugin guide'

export function PluginDevelopmentGuide(): JSX.Element {
  const { t } = useTranslation()
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const copyGuide = async (): Promise<void> => {
    setCopyState('copying')
    try {
      await window.opencoveApi.clipboard.writeText(GUIDE_COMMAND)
      if (mountedRef.current) {
        setCopyState('copied')
      }
    } catch {
      if (mountedRef.current) {
        setCopyState('error')
      }
    }
  }
  return (
    <SettingsGroup
      id="settings-section-plugin-guide"
      className="settings-plugin-development"
      title={t('settingsPanel.plugins.guideTitle')}
      description={t('settingsPanel.plugins.guideHelp')}
    >
      <div className="settings-plugin-guide">
        <span className="settings-plugin-guide__command">
          <Terminal size={15} aria-hidden="true" />
          <code>{GUIDE_COMMAND}</code>
        </span>
        <button
          type="button"
          className="secondary"
          data-testid="settings-plugin-guide-copy"
          disabled={copyState === 'copying'}
          onClick={() => void copyGuide()}
        >
          <Copy size={14} aria-hidden="true" />
          {t('settingsPanel.plugins.copyGuide')}
        </button>
      </div>
      <p className="settings-plugin-guide__feedback" role="status">
        {copyState === 'copied' ? t('settingsPanel.plugins.copied') : null}
        {copyState === 'error' ? t('settingsPanel.plugins.copyFailed') : null}
      </p>
    </SettingsGroup>
  )
}
