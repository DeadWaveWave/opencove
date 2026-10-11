import { appendPluginRuntimeLog, type PluginRuntimeView } from './PluginRuntimeState'
import type { PluginFilesPort } from './PluginRuntimePorts'

export async function cleanupPluginView(view: PluginRuntimeView, files: PluginFilesPort) {
  const report = (name: string, error: unknown) =>
    appendPluginRuntimeLog(
      view.runtime,
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    )
  await view.backend?.dispose().catch(error => report('Preview cleanup', error))
  if (view.context.preview) {
    await files
      .removePreviewData(view.context.pluginId, view.id)
      .catch(error => report('Preview data cleanup', error))
  }
}
