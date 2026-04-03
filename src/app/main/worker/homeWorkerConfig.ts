import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createAppError } from '../../../shared/errors/appError'
import type {
  HomeWorkerConfigDto,
  HomeWorkerMode,
  RemoteWorkerEndpointDto,
  SetHomeWorkerConfigInput,
} from '../../../shared/contracts/dto'

const HOME_WORKER_CONFIG_FILE = 'home-worker.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeHomeWorkerMode(value: unknown): HomeWorkerMode | null {
  if (value === 'standalone' || value === 'local' || value === 'remote') {
    return value
  }

  return null
}

function normalizeRemoteEndpoint(value: unknown): RemoteWorkerEndpointDto | null {
  if (value === null) {
    return null
  }

  if (!isRecord(value)) {
    return null
  }

  const hostname = normalizeOptionalString(value.hostname)
  if (!hostname) {
    return null
  }

  const port = value.port
  if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0 || port > 65_535) {
    return null
  }

  const token = normalizeOptionalString(value.token)
  if (!token) {
    return null
  }

  return { hostname, port, token }
}

export function createDefaultHomeWorkerConfig(): HomeWorkerConfigDto {
  return {
    version: 1,
    mode: 'standalone',
    remote: null,
    updatedAt: null,
  }
}

export function resolveHomeWorkerConfigPath(userDataPath: string): string {
  return resolve(userDataPath, HOME_WORKER_CONFIG_FILE)
}

export async function readHomeWorkerConfig(userDataPath: string): Promise<HomeWorkerConfigDto> {
  const filePath = resolveHomeWorkerConfigPath(userDataPath)

  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== 1) {
      return createDefaultHomeWorkerConfig()
    }

    const mode = normalizeHomeWorkerMode(parsed.mode)
    if (!mode) {
      return createDefaultHomeWorkerConfig()
    }

    const remote = normalizeRemoteEndpoint(parsed.remote)
    const updatedAt = normalizeOptionalString(parsed.updatedAt)

    return {
      version: 1,
      mode,
      remote,
      updatedAt,
    }
  } catch {
    return createDefaultHomeWorkerConfig()
  }
}

export async function writeHomeWorkerConfig(
  userDataPath: string,
  config: HomeWorkerConfigDto,
): Promise<void> {
  const filePath = resolveHomeWorkerConfigPath(userDataPath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function setHomeWorkerConfig(
  userDataPath: string,
  input: SetHomeWorkerConfigInput,
): Promise<HomeWorkerConfigDto> {
  if (!isRecord(input)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid home worker config.' })
  }

  const mode = normalizeHomeWorkerMode(input.mode)
  if (!mode) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid home worker mode.' })
  }

  const remote = normalizeRemoteEndpoint(input.remote)
  if (mode === 'remote' && !remote) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Remote mode requires a remote worker endpoint.',
    })
  }

  if (mode !== 'remote' && remote !== null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Remote endpoint can only be configured for remote mode.',
    })
  }

  const next: HomeWorkerConfigDto = {
    version: 1,
    mode,
    remote,
    updatedAt: new Date().toISOString(),
  }

  await writeHomeWorkerConfig(userDataPath, next)
  return next
}
