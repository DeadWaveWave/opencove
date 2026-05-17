import type { WorkerConnectionInfoDto } from '../../../shared/contracts/dto'

export function parseWorkerReadyPayload(value: unknown): WorkerConnectionInfoDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const hostname = typeof record.hostname === 'string' ? record.hostname : null
  const port = typeof record.port === 'number' ? record.port : null
  const token = typeof record.token === 'string' ? record.token : null
  const pid = typeof record.pid === 'number' ? record.pid : null
  const version = typeof record.version === 'number' ? record.version : null
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null
  const appVersion =
    typeof record.appVersion === 'string' && record.appVersion.trim().length > 0
      ? record.appVersion.trim()
      : null
  const startedBy =
    record.startedBy === 'cli' || record.startedBy === 'desktop' ? record.startedBy : null

  if (!hostname || !port || !token || !pid || !version || !createdAt) {
    return null
  }

  return {
    version,
    pid,
    hostname,
    port,
    token,
    createdAt,
    appVersion,
    ...(startedBy ? { startedBy } : {}),
  }
}
