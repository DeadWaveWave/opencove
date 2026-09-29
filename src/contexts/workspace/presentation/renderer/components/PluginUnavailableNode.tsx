import { Puzzle } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { CanvasNodeWindow, type CanvasNodeWindowProps } from './shared/CanvasNodeWindow'

export function PluginUnavailableNode({
  reason,
  ...windowProps
}: Omit<CanvasNodeWindowProps, 'children'> & {
  reason: 'disabled' | 'missing' | 'schemaUnavailable'
}) {
  const { t } = useTranslation()
  return (
    <CanvasNodeWindow {...windowProps}>
      <div className="plugin-node-unavailable" data-testid={`plugin-node-${reason}`} role="status">
        <Puzzle size={24} strokeWidth={1.5} aria-hidden="true" />
        <strong>{t(`plugins.${reason}`)}</strong>
        <p>{t('plugins.retained')}</p>
        <button
          type="button"
          className="cove-window__action cove-window__action--secondary"
          data-testid="plugin-node-open-settings"
          onClick={event => {
            event.stopPropagation()
            const store = useAppStore.getState()
            store.setSettingsOpenPageId('plugins')
            store.setIsSettingsOpen(true)
          }}
        >
          {t('plugins.openSettings')}
        </button>
      </div>
    </CanvasNodeWindow>
  )
}
