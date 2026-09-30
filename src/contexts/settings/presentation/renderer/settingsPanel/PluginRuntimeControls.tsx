import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'
import { useState, type JSX } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'
import type { PluginDetails } from '@contexts/plugins/domain/pluginRuntimeTypes'
import { PluginSourceControls } from './PluginSourceControls'
import { changeInstalledPlugin } from '@contexts/plugins/presentation/renderer/usePluginRegistry'

export function PluginRuntimeControls({
  plugin,
  detail,
  onRemoved,
}: {
  plugin: PluginManifest
  detail: PluginDetails | null
  onRemoved: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(command: 'plugin.reload' | 'plugin.uninstall'): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await changeInstalledPlugin<{
        status?: string
        error?: string
        candidateDirectory?: string
      }>(command, { pluginId: plugin.id })
      if (result?.status === 'failed' || result?.status === 'conflict') {
        throw new Error(
          [result.error, result.candidateDirectory].filter(Boolean).join('\n') ||
            t('settingsPanel.plugins.source.failed'),
        )
      }
      if (command === 'plugin.uninstall') {
        onRemoved()
      }
    } catch (cause) {
      setError(pluginErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="settings-plugin-runtime"
      aria-label={t('settingsPanel.plugins.runtime.manage')}
    >
      <div className="settings-plugin-runtime__actions">
        <button
          type="button"
          className="cove-window__action cove-window__action--secondary"
          disabled={busy}
          onClick={() => {
            void run('plugin.reload')
          }}
          data-testid="settings-plugin-reload"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {t('settingsPanel.plugins.reload')}
        </button>
        <button
          type="button"
          className="cove-window__action cove-window__action--ghost"
          disabled={busy}
          onClick={() => setConfirmRemove(value => !value)}
          data-testid="settings-plugin-uninstall"
        >
          <Trash2 size={14} aria-hidden="true" />
          {t('settingsPanel.plugins.uninstall')}
        </button>
      </div>
      {confirmRemove ? (
        <div className="settings-plugin-runtime__confirmation">
          <p>{t('settingsPanel.plugins.uninstallHelp')}</p>
          <button
            type="button"
            className="cove-window__action cove-window__action--danger"
            disabled={busy}
            onClick={() => {
              void run('plugin.uninstall')
            }}
            data-testid="settings-plugin-confirm-uninstall"
          >
            {t('settingsPanel.plugins.uninstall')}
          </button>
        </div>
      ) : null}
      {plugin.error || error ? (
        <p className="cove-window__error" role="alert">
          {error ?? plugin.error}
        </p>
      ) : null}
      {detail?.sourceDirectory ? (
        <p className="settings-plugin-runtime__source" title={detail.sourceDirectory}>
          {detail.sourceDirectory}
        </p>
      ) : null}
      <PluginSourceControls key={plugin.id} plugin={plugin} />
      {detail?.logs.length ? (
        <details className="settings-plugin-runtime__logs">
          <summary>{t('settingsPanel.plugins.logs')}</summary>
          <pre>{detail.logs.join('\n')}</pre>
        </details>
      ) : null}
    </section>
  )
}
