import { assertPluginRuntimeGeneration } from './PluginRuntimeState'
import type { PluginPublicationExpectation } from '../domain/pluginDistributionTypes'
import type {
  PluginFilesPort,
  PluginInstallationRecord,
  PluginSnapshot,
  PluginBackend,
  PluginBackendPort,
} from './PluginRuntimePorts'
import type { PluginRuntimeState } from './PluginRuntimeState'

export function replacePluginRecord(
  records: Iterable<PluginRuntimeState>,
  id: string,
  next: PluginInstallationRecord | null,
): PluginInstallationRecord[] {
  return [...records]
    .filter(runtime => runtime.record.package.id !== id)
    .map(runtime => runtime.record)
    .concat(next ? [next] : [])
}
export async function publishPluginSnapshot(
  snapshot: PluginSnapshot,
  enabled: boolean,
  owner: {
    previous?: PluginRuntimeState
    files: PluginFilesPort
    records: Iterable<PluginRuntimeState>
    startBackend: (runtime: PluginRuntimeState) => Promise<PluginBackend | null>
    beforePublish?: () => Promise<void>
    assertOpen: () => void
    commit: (runtime: PluginRuntimeState) => void
    retire: (runtime: PluginRuntimeState) => Promise<void>
    closed: () => boolean
  },
): Promise<PluginRuntimeState> {
  const { directory: _directory, ...base } = snapshot
  const previous = owner.previous
  const history =
    previous && previous.record.revision !== snapshot.revision
      ? [
          {
            package: previous.record.package,
            revision: previous.record.revision,
            sourceDirectory: previous.record.sourceDirectory,
            distribution: previous.record.distribution,
          },
          ...(previous.record.history ?? []),
        ]
          .filter(
            (value, index, all) =>
              value.revision !== snapshot.revision &&
              all.findIndex(item => item.revision === value.revision) === index,
          )
          .slice(0, 20)
      : (previous?.record.history ?? snapshot.history)
  const record: PluginInstallationRecord = {
    ...base,
    enabled,
    ...(history?.length ? { history } : {}),
  }
  const candidate: PluginRuntimeState = {
    record,
    snapshot: { ...snapshot, ...record },
    backend: null,
    error: null,
    logs: [],
  }
  try {
    if (enabled) {
      candidate.backend = await owner.startBackend(candidate)
    }
    await owner.beforePublish?.()
    owner.assertOpen()
    if (candidate.error) {
      throw new Error(candidate.error)
    }
    await owner.files.writeRegistry(replacePluginRecord(owner.records, record.package.id, record))
    owner.commit(candidate)
  } catch (error) {
    await candidate.backend?.dispose()
    throw error
  }
  if (previous) {
    await owner.retire(previous)
  }
  if (owner.closed()) {
    await owner.retire(candidate)
  }
  return candidate
}

export async function startPluginBackend(
  runtime: PluginRuntimeState,
  backendPort: PluginBackendPort,
  files: PluginFilesPort,
  log: (message: string) => void,
  host: Pick<Parameters<PluginBackendPort['start']>[1], 'hostRequest' | 'hostClosed'> = {},
): Promise<PluginBackend | null> {
  if (!runtime.snapshot?.package.main) {
    return null
  }
  const backend = await backendPort.start(runtime.snapshot, {
    ...host,
    dataDirectory: files.dataDirectory(runtime.record.package.id),
    log,
    unavailable: message => {
      runtime.error = message
      log(message)
    },
  })
  if (
    runtime.record.package.contributes?.commands?.some(command => command.target === 'plugin') &&
    !backend.runCommand
  ) {
    await backend.dispose()
    throw new Error('Plugin backend must provide runCommand for declared plugin commands.')
  }
  return backend
}

export function assertPluginPublication(
  previous: PluginRuntimeState | undefined,
  snapshot: PluginSnapshot,
  expected: PluginPublicationExpectation | null,
  runtimeEpoch: string,
  reservedIds: readonly string[],
): void {
  if (reservedIds.includes(snapshot.package.id)) {
    throw new Error('A built-in plugin already uses this id.')
  }
  if (!expected && previous) {
    throw new Error('Plugin already installed.')
  }
  if (expected) {
    if (
      !previous ||
      runtimeEpoch !== expected.runtimeEpoch ||
      previous.record.sourceDirectory !== expected.sourceDirectory
    ) {
      throw new Error('Candidate source is stale; prepare a fresh update.')
    }
    assertPluginRuntimeGeneration(previous, expected)
  }
}
