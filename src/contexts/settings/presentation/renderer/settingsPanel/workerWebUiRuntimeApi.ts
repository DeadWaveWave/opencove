import type { HomeWorkerConfigurationSnapshotDto } from '@shared/contracts/dto'
import {
  normalizeHomeWorkerConfigurationFailureDetails,
  normalizeHomeWorkerConfigurationSnapshot,
} from '@shared/runtime/homeWorkerConfigurationValidation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readWorkerConfigurationSnapshotFromError(
  error: unknown,
): HomeWorkerConfigurationSnapshotDto | null {
  if (!isRecord(error) || error.details === undefined) {
    return null
  }
  try {
    return normalizeHomeWorkerConfigurationFailureDetails(error.details).configurationSnapshot
  } catch {
    return null
  }
}

export async function readWorkerConfigurationSnapshot(): Promise<HomeWorkerConfigurationSnapshotDto> {
  const readSnapshot = window.opencoveApi.workerClient.getConfigurationSnapshot
  const value =
    typeof readSnapshot === 'function'
      ? await readSnapshot()
      : {
          config: await window.opencoveApi.workerClient.getConfig(),
          webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
        }
  return normalizeHomeWorkerConfigurationSnapshot(value)
}
