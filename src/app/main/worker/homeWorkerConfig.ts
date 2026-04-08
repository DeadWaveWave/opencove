import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createAppError } from '../../../shared/errors/appError'
import type {
  HomeWorkerConfigDto,
  HomeWorkerMode,
  RemoteWorkerEndpointDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '../../../shared/contracts/dto'
import { hashWebUiPassword, isValidWebUiPasswordHash } from '../controlSurface/http/webUiPassword'

const HOME_WORKER_CONFIG_FILE = 'home-worker.json'

const DEFAULT_WEB_UI_CONFIG = {
  enabled: false,
  port: null as number | null,
  exposeOnLan: false,
  passwordHash: null as string | null,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'boolean') {
    return null
  }

  return value
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

function normalizeOptionalPort(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.floor(value)
  if (normalized <= 0 || normalized > 65_535) {
    return null
  }

  return normalized
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

export type HomeWorkerWebUiConfigFile = {
  enabled: boolean
  port: number | null
  exposeOnLan: boolean
  passwordHash: string | null
}

function normalizeWebUiConfig(value: unknown): HomeWorkerWebUiConfigFile {
  if (!isRecord(value)) {
    return { ...DEFAULT_WEB_UI_CONFIG }
  }

  const enabled = normalizeOptionalBoolean(value.enabled) ?? DEFAULT_WEB_UI_CONFIG.enabled
  const port = normalizeOptionalPort(value.port) ?? DEFAULT_WEB_UI_CONFIG.port
  const exposeOnLan =
    normalizeOptionalBoolean(value.exposeOnLan) ?? DEFAULT_WEB_UI_CONFIG.exposeOnLan
  const passwordHash =
    typeof value.passwordHash === 'string' && isValidWebUiPasswordHash(value.passwordHash)
      ? value.passwordHash.trim()
      : DEFAULT_WEB_UI_CONFIG.passwordHash

  return {
    enabled,
    port,
    exposeOnLan: exposeOnLan && passwordHash !== null,
    passwordHash,
  }
}

export type HomeWorkerConfigFile = {
  version: 1
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
  webUi: HomeWorkerWebUiConfigFile
  updatedAt: string | null
}

function toDto(config: HomeWorkerConfigFile): HomeWorkerConfigDto {
  return {
    version: 1,
    mode: config.mode,
    remote: config.remote,
    webUi: {
      enabled: config.webUi.enabled,
      port: config.webUi.port,
      exposeOnLan: config.webUi.exposeOnLan,
      passwordSet: config.webUi.passwordHash !== null,
    },
    updatedAt: config.updatedAt,
  }
}

function createDefaultHomeWorkerConfigFile(): HomeWorkerConfigFile {
  return {
    version: 1,
    mode: 'standalone',
    remote: null,
    webUi: { ...DEFAULT_WEB_UI_CONFIG },
    updatedAt: null,
  }
}

export function createDefaultHomeWorkerConfig(): HomeWorkerConfigDto {
  return toDto(createDefaultHomeWorkerConfigFile())
}

export function resolveHomeWorkerConfigPath(userDataPath: string): string {
  return resolve(userDataPath, HOME_WORKER_CONFIG_FILE)
}

export async function readHomeWorkerConfigFile(
  userDataPath: string,
): Promise<HomeWorkerConfigFile> {
  const filePath = resolveHomeWorkerConfigPath(userDataPath)

  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== 1) {
      return createDefaultHomeWorkerConfigFile()
    }

    const mode = normalizeHomeWorkerMode(parsed.mode)
    if (!mode) {
      return createDefaultHomeWorkerConfigFile()
    }

    const remote = normalizeRemoteEndpoint(parsed.remote)
    const updatedAt = normalizeOptionalString(parsed.updatedAt)
    const webUi = normalizeWebUiConfig(parsed.webUi)

    return {
      version: 1,
      mode,
      remote,
      webUi,
      updatedAt,
    }
  } catch {
    return createDefaultHomeWorkerConfigFile()
  }
}

export async function readHomeWorkerConfig(userDataPath: string): Promise<HomeWorkerConfigDto> {
  return toDto(await readHomeWorkerConfigFile(userDataPath))
}

async function writeHomeWorkerConfigFile(
  userDataPath: string,
  config: HomeWorkerConfigFile,
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

  const previous = await readHomeWorkerConfigFile(userDataPath)
  const next: HomeWorkerConfigFile = {
    version: 1,
    mode,
    remote,
    webUi: previous.webUi,
    updatedAt: new Date().toISOString(),
  }

  await writeHomeWorkerConfigFile(userDataPath, next)
  return toDto(next)
}

export async function setHomeWorkerWebUiSecurity(
  userDataPath: string,
  input: SetHomeWorkerWebUiSecurityInput,
): Promise<HomeWorkerConfigDto> {
  if (!isRecord(input)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid home worker web ui security config.',
    })
  }

  const exposeOnLan = normalizeOptionalBoolean(input.exposeOnLan)
  if (exposeOnLan === null) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid exposeOnLan value.' })
  }

  const password = normalizeOptionalString(input.password)
  const previous = await readHomeWorkerConfigFile(userDataPath)

  const nextPasswordHash = password
    ? await hashWebUiPassword(password)
    : previous.webUi.passwordHash

  if (exposeOnLan && nextPasswordHash === null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Enabling LAN Web UI requires a password.',
    })
  }

  const next: HomeWorkerConfigFile = {
    ...previous,
    webUi: {
      ...previous.webUi,
      exposeOnLan,
      passwordHash: nextPasswordHash,
    },
    updatedAt: new Date().toISOString(),
  }

  await writeHomeWorkerConfigFile(userDataPath, next)
  return toDto(next)
}

function normalizeWebUiSettingsInput(value: unknown): { enabled: boolean; port: number | null } {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid home worker web ui settings config.',
    })
  }

  const enabled = normalizeOptionalBoolean(value.enabled)
  if (enabled === null) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid web ui enabled value.' })
  }

  const rawPort = (value as Record<string, unknown>).port
  const port = (() => {
    if (rawPort === null || rawPort === undefined) {
      return null
    }

    if (typeof rawPort !== 'number' || !Number.isFinite(rawPort)) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid web ui port value.' })
    }

    if (!Number.isInteger(rawPort) || rawPort < 0 || rawPort > 65_535) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid web ui port value.' })
    }

    return rawPort === 0 ? null : rawPort
  })()

  return { enabled, port }
}

export async function setHomeWorkerWebUiSettings(
  userDataPath: string,
  input: SetHomeWorkerWebUiSettingsInput,
): Promise<HomeWorkerConfigDto> {
  const { enabled, port } = normalizeWebUiSettingsInput(input)
  const previous = await readHomeWorkerConfigFile(userDataPath)

  const next: HomeWorkerConfigFile = {
    ...previous,
    webUi: {
      ...previous.webUi,
      enabled,
      port,
    },
    updatedAt: new Date().toISOString(),
  }

  await writeHomeWorkerConfigFile(userDataPath, next)
  return toDto(next)
}
