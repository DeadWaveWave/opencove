import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest } from '../../domain/pluginTypes'
import type { PluginOpenViewResult } from '../../domain/pluginRuntimeTypes'
import { bindPluginViewBridge } from './pluginViewBridge'
import { pluginErrorMessage } from './pluginErrorMessage'
import './generic-plugin-view.css'

export interface GenericPluginViewProps {
  plugin: PluginManifest
  nodeId: string
  workspaceId?: string
  directoryPath?: string
  preview?: boolean
  onTitleChange?: (title: string) => void
  onViewReset?: () => void
}

export function GenericPluginView({
  plugin,
  nodeId,
  workspaceId,
  directoryPath,
  preview = false,
  onTitleChange,
  onViewReset,
}: GenericPluginViewProps) {
  const { t } = useTranslation()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const titleCallback = useRef(onTitleChange)
  titleCallback.current = onTitleChange
  const resetCallback = useRef(onViewReset)
  resetCallback.current = onViewReset
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let disposed = false
    let viewId: string | null = null
    let unbind = () => {}
    const api = window.opencoveApi.controlSurface
    const close = (id: string) => {
      void api
        .invoke({ kind: 'command', id: 'plugin.view.close', payload: { viewId: id } })
        .catch(() => {})
    }
    setSource(null)
    setError(null)
    resetCallback.current?.()
    void (async () => {
      const view = await api.invoke<PluginOpenViewResult>({
        kind: 'command',
        id: 'plugin.view.open',
        payload: { pluginId: plugin.id, nodeId, workspaceId, directoryPath, preview },
      })
      if (disposed) {
        close(view.viewId)
        return
      }
      viewId = view.viewId
      const url = await api.resolvePluginResourceUrl(view.resourcePath)
      if (disposed) {
        return
      }
      unbind = bindPluginViewBridge({
        view,
        url,
        getFrame: () => frameRef.current,
        onTitleChange: title => titleCallback.current?.(title),
        onRestore: () => setAttempt(value => value + 1),
      })
      setSource(url)
    })().catch(reason => {
      if (viewId) {
        close(viewId)
        viewId = null
      }
      if (!disposed) {
        setError(pluginErrorMessage(reason))
      }
    })
    return () => {
      disposed = true
      unbind()
      resetCallback.current?.()
      if (viewId) {
        close(viewId)
      }
    }
  }, [
    plugin.id,
    plugin.revision,
    plugin.runtimeGeneration,
    plugin.enabled,
    plugin.status,
    nodeId,
    workspaceId,
    directoryPath,
    preview,
    attempt,
  ])

  return (
    <div className="cove-plugin-view nodrag nowheel" data-testid={`plugin-view-${plugin.id}`}>
      {source ? (
        <iframe
          ref={frameRef}
          src={source}
          title={plugin.displayName}
          allow="autoplay; clipboard-write"
          // eslint-disable-next-line react/iframe-missing-sandbox -- Trusted plugin views require an origin-checked SDK and module resources; these flags prevent accidental top navigation, not privileged-code access.
          sandbox="allow-scripts allow-same-origin allow-popups allow-downloads allow-forms"
          referrerPolicy="no-referrer"
          data-testid={`plugin-frame-${plugin.id}`}
        />
      ) : error ? (
        <div className="cove-plugin-view__status" role="alert">
          <strong>{t('settingsPanel.plugins.runtime.failed')}</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>
            {t('settingsPanel.plugins.runtime.retry')}
          </button>
        </div>
      ) : (
        <div className="cove-plugin-view__status" role="status">
          {t('settingsPanel.plugins.runtime.loading')}
        </div>
      )}
    </div>
  )
}
