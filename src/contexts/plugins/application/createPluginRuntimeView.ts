import type { PluginOpenViewInput, PluginViewContext } from '../domain/pluginRuntimeTypes'
import type { PluginBackendPort, PluginFilesPort } from './PluginRuntimePorts'
import type { PluginRuntimeState, PluginRuntimeView } from './PluginRuntimeState'
import { appendPluginRuntimeLog } from './PluginRuntimeState'

export async function createPluginRuntimeView(
  input: PluginOpenViewInput,
  runtime: PluginRuntimeState,
  deps: {
    id: string
    token: string
    backend: PluginBackendPort
    files: PluginFilesPort
    closed(): boolean
  },
): Promise<PluginRuntimeView> {
  const context: PluginViewContext = {
    pluginId: input.pluginId,
    nodeId: input.nodeId,
    workspaceId: input.workspaceId ?? null,
    directoryPath: input.directoryPath ?? null,
    preview: input.preview === true,
  }
  const view: PluginRuntimeView = {
    id: deps.id,
    token: deps.token,
    runtime,
    context,
    backend: null,
    storage: new Map(),
  }
  try {
    if (context.preview && runtime.snapshot?.package.main) {
      view.backend = await deps.backend.start(runtime.snapshot, {
        dataDirectory: `${deps.files.dataDirectory(input.pluginId)}/previews/${deps.id}`,
        log: message => appendPluginRuntimeLog(runtime, `[preview] ${message}`),
        unavailable: message => appendPluginRuntimeLog(runtime, `[preview] ${message}`),
      })
    }
    if (deps.closed()) {
      throw new Error('Plugin runtime is shutting down.')
    }
    return view
  } catch (error) {
    await view.backend?.dispose().catch(() => undefined)
    if (context.preview) {
      await deps.files.removePreviewData(input.pluginId, deps.id).catch(() => undefined)
    }
    throw error
  }
}
