import type { PluginRuntimeState } from './PluginRuntimeState'
import type { PluginBackend, PluginFilesPort } from './PluginRuntimePorts'

/** Restore only the published registry; retained source candidates are never activated implicitly. */
export async function restorePluginInstallations(owner: {
  files: PluginFilesPort
  reservedIds: readonly string[]
  closed: () => boolean
  commit: (runtime: PluginRuntimeState) => void
  startBackend: (runtime: PluginRuntimeState) => Promise<PluginBackend | null>
}): Promise<Error | null> {
  let records
  try {
    records = await owner.files.readRegistry()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  // Limit startup fan-out and observe shutdown before each plugin.
  /* eslint-disable no-await-in-loop */
  for (const record of records) {
    if (owner.closed()) {
      return null
    }
    const runtime: PluginRuntimeState = {
      record,
      snapshot: null,
      backend: null,
      error: null,
      logs: [],
    }
    owner.commit(runtime)
    try {
      if (owner.reservedIds.includes(record.package.id)) {
        throw new Error('Plugin id belongs to a built-in plugin.')
      }
      runtime.snapshot = await owner.files.restore(record)
      if (record.enabled && !owner.closed()) {
        runtime.backend = await owner.startBackend(runtime)
      }
      if (owner.closed()) {
        await runtime.backend?.dispose()
      }
    } catch (error) {
      runtime.error = error instanceof Error ? error.message : String(error)
    }
  }
  /* eslint-enable no-await-in-loop */
  return null
}
