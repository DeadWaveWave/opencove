import { pluginThemeContext } from './pluginThemeContext'
import { publicFileSystemError } from '../../../../shared/errors/filesystemError'
import { formatAppErrorMessage } from '../../../../shared/errors/appError'
import type { PluginOpenViewResult } from '../../domain/pluginRuntimeTypes'
import { pluginErrorMessage } from './pluginErrorMessage'

const CHANNEL = 'opencove-plugin-v1'

export function bindPluginViewBridge({
  view,
  url,
  getFrame,
  onTitleChange,
  onRestore,
}: {
  view: PluginOpenViewResult
  url: string
  getFrame: () => HTMLIFrameElement | null
  onTitleChange: (title: string) => void
  onRestore: () => void
}): () => void {
  const origin = new URL(url).origin
  let disposed = false
  let restoring = false
  let titleUpdates: Promise<unknown> = Promise.resolve()
  const post = (message: Record<string, unknown>) => {
    if (!disposed && !restoring) {
      getFrame()?.contentWindow?.postMessage({ channel: CHANNEL, ...message }, origin)
    }
  }
  const invoke = (method: string, payload: Record<string, unknown>) =>
    window.opencoveApi.controlSurface.invoke({
      kind: ['plugin.storage.get', 'plugin.view.preferences.get'].includes(method)
        ? 'query'
        : 'command',
      id: method,
      payload: { ...payload, viewId: view.viewId },
    })
  const setTitle = (title: string): Promise<null> => {
    const next = titleUpdates.then(async () => {
      if (disposed || restoring) {
        throw new Error('Plugin view closed before title update.')
      }
      if (!view.context.preview) {
        await invoke('plugin.view.setTitle', { title })
      }
      if (!disposed && !restoring) {
        onTitleChange(title)
      }
      return null
    })
    titleUpdates = next.catch(() => undefined)
    return next
  }
  const onMessage = (event: MessageEvent) => {
    if (
      disposed ||
      restoring ||
      event.source !== getFrame()?.contentWindow ||
      event.origin !== origin
    ) {
      return
    }
    const data: unknown = event.data
    if (!data || typeof data !== 'object') {
      return
    }
    const message = data as Record<string, unknown>
    if (message.channel !== CHANNEL) {
      return
    }
    if (message.type === 'restore') {
      restoring = true
      onRestore()
      return
    }
    if (message.type === 'ready') {
      post({ type: 'init', context: { ...view.context, apiVersion: 1, ...pluginThemeContext() } })
      return
    }
    if (message.type !== 'request' || typeof message.id !== 'string' || message.id.length > 128) {
      return
    }
    const payload = message.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return
    }
    const input = payload as Record<string, unknown>
    void (async () => {
      switch (message.operation) {
        case 'host.request':
          return invoke('plugin.host.request', {
            operation: input.operation,
            payload: input.payload,
          })
        case 'invoke':
          return invoke('plugin.invoke', { method: input.method, params: input.params })
        case 'preferences.get':
          return invoke('plugin.view.preferences.get', {})
        case 'preferences.set':
          return invoke('plugin.view.preferences.set', { key: input.key, value: input.value })
        case 'storage.get':
          return invoke('plugin.storage.get', { key: input.key })
        case 'storage.set':
          return invoke('plugin.storage.set', { key: input.key, value: input.value })
        case 'title':
          if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) {
            throw new Error('Invalid plugin window title')
          }
          return setTitle(input.title.trim())
        default:
          throw new Error('Unsupported plugin view operation')
      }
    })()
      .then(value => post({ type: 'result', id: message.id, value }))
      .catch(error => {
        const errorDescriptor = publicFileSystemError(error)
        post({
          type: 'result',
          id: message.id,
          error: errorDescriptor
            ? formatAppErrorMessage(errorDescriptor)
            : pluginErrorMessage(error),
          ...(errorDescriptor ? { errorDescriptor } : {}),
        })
      })
  }
  const onTheme = () => post({ type: 'theme', context: pluginThemeContext() })
  window.addEventListener('message', onMessage)
  window.addEventListener('opencove-theme-changed', onTheme)
  window.addEventListener('opencove-ui-font-scale-changed', onTheme)
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  reducedMotion?.addEventListener?.('change', onTheme)
  return () => {
    disposed = true
    window.removeEventListener('message', onMessage)
    window.removeEventListener('opencove-theme-changed', onTheme)
    window.removeEventListener('opencove-ui-font-scale-changed', onTheme)
    reducedMotion?.removeEventListener?.('change', onTheme)
  }
}
