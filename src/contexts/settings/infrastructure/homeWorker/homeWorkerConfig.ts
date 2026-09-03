import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createAppError } from '../../../../shared/errors/appError'
import {
  createSerialOperationQueue,
  type SerialOperationQueue,
} from '../../../../shared/runtime/serialOperationQueue'
import type {
  HomeWorkerConfigDto,
  HomeWorkerMode,
  RemoteWorkerEndpointDto,
} from '../../../../shared/contracts/dto'
import { isValidWebUiPasswordHash } from './webUiPassword'
import type {
  HomeWorkerConfigFile,
  HomeWorkerConfigModeOptions,
  HomeWorkerWebUiConfigFile,
} from '../../domain/homeWorkerConfig'
export type {
  HomeWorkerConfigFile,
  HomeWorkerConfigModeOptions,
  HomeWorkerWebUiConfigFile,
} from '../../domain/homeWorkerConfig'
import {
  writeTextFileAtomically,
  type AtomicTextFileWriteDependencies,
} from './homeWorkerConfigPersistence'

const HOME_WORKER_CONFIG_FILE = 'home-worker.json'

const DEFAULT_WEB_UI_CONFIG = {
  enabled: false,
  port: null as number | null,
  exposeOnLan: false,
  passwordHash: null as string | null,
} as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'boolean') {
    return null
  }

  return value
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeConfigRevision(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    return null
  }

  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  try {
    return new Date(timestamp).toISOString() === normalized ? normalized : null
  } catch {
    return null
  }
}

function createNextConfigRevision(previous: string | null, now: Date): string {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Home worker config clock returned an invalid timestamp.',
    })
  }

  const previousMs = previous === null ? Number.NEGATIVE_INFINITY : Date.parse(previous)
  const nextMs = Math.max(nowMs, previousMs + 1)
  try {
    return new Date(nextMs).toISOString()
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Home worker config revision cannot advance.',
    })
  }
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

export function normalizeHomeWorkerMode(value: unknown): HomeWorkerMode | null {
  if (value === 'standalone' || value === 'local' || value === 'remote') {
    return value
  }

  return null
}

export function normalizeRemoteEndpoint(value: unknown): RemoteWorkerEndpointDto | null {
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

function isStandaloneModeAllowed(options?: HomeWorkerConfigModeOptions): boolean {
  return options?.allowStandaloneMode ?? true
}

function isRemoteModeAllowed(options?: HomeWorkerConfigModeOptions): boolean {
  return options?.allowRemoteMode ?? true
}

function resolveDefaultHomeWorkerMode(options?: HomeWorkerConfigModeOptions): HomeWorkerMode {
  return isStandaloneModeAllowed(options) ? 'standalone' : 'local'
}

export function isModeSupported(
  mode: HomeWorkerMode,
  options?: HomeWorkerConfigModeOptions,
): boolean {
  if (mode === 'standalone') {
    return isStandaloneModeAllowed(options)
  }

  if (mode === 'remote') {
    return isRemoteModeAllowed(options)
  }

  return true
}

export function toDto(config: HomeWorkerConfigFile): HomeWorkerConfigDto {
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

function createDefaultHomeWorkerConfigFile(
  options?: HomeWorkerConfigModeOptions,
): HomeWorkerConfigFile {
  return {
    version: 1,
    mode: resolveDefaultHomeWorkerMode(options),
    remote: null,
    webUi: { ...DEFAULT_WEB_UI_CONFIG },
    updatedAt: null,
  }
}

function normalizeConfigFile(
  value: unknown,
  options?: HomeWorkerConfigModeOptions,
): { config: HomeWorkerConfigFile; repaired: boolean } {
  if (!isRecord(value) || value.version !== 1) {
    return { config: createDefaultHomeWorkerConfigFile(options), repaired: true }
  }

  const parsedMode = normalizeHomeWorkerMode(value.mode)
  if (!parsedMode) {
    return { config: createDefaultHomeWorkerConfigFile(options), repaired: true }
  }

  const parsedRemote = normalizeRemoteEndpoint(value.remote)
  const mode =
    parsedMode === 'remote' && parsedRemote === null
      ? resolveDefaultHomeWorkerMode(options)
      : isModeSupported(parsedMode, options)
        ? parsedMode
        : resolveDefaultHomeWorkerMode(options)
  const remote = mode === 'remote' ? parsedRemote : null
  const updatedAt = normalizeConfigRevision(value.updatedAt)
  const webUi = normalizeWebUiConfig(value.webUi)

  return {
    config: {
      version: 1,
      mode,
      remote,
      webUi,
      updatedAt,
    },
    repaired:
      mode !== parsedMode ||
      remote !== parsedRemote ||
      !isRecord(value.webUi) ||
      updatedAt !== (typeof value.updatedAt === 'string' ? value.updatedAt.trim() || null : null),
  }
}

export function createDefaultHomeWorkerConfig(
  options?: HomeWorkerConfigModeOptions,
): HomeWorkerConfigDto {
  return toDto(createDefaultHomeWorkerConfigFile(options))
}

export function resolveHomeWorkerConfigPath(userDataPath: string): string {
  return resolve(userDataPath, HOME_WORKER_CONFIG_FILE)
}

export async function readHomeWorkerConfigFile(
  userDataPath: string,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigFile> {
  const filePath = resolveHomeWorkerConfigPath(userDataPath)

  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeConfigFile(parsed, options).config
  } catch {
    return createDefaultHomeWorkerConfigFile(options)
  }
}

export async function ensureHomeWorkerConfigFile(
  userDataPath: string,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigFile> {
  const filePath = resolveHomeWorkerConfigPath(userDataPath)

  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeConfigFile(parsed, options)
    if (normalized.repaired) {
      await writeHomeWorkerConfigFile(userDataPath, normalized.config)
    }
    return normalized.config
  } catch {
    const config = createDefaultHomeWorkerConfigFile(options)
    await writeHomeWorkerConfigFile(userDataPath, config)
    return config
  }
}

export async function readHomeWorkerConfig(
  userDataPath: string,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigDto> {
  return toDto(await readHomeWorkerConfigFile(userDataPath, options))
}

export async function ensureHomeWorkerConfig(
  userDataPath: string,
  options?: HomeWorkerConfigModeOptions,
): Promise<HomeWorkerConfigDto> {
  return toDto(await ensureHomeWorkerConfigFile(userDataPath, options))
}

export type HomeWorkerConfigFileWriteDependencies = AtomicTextFileWriteDependencies

export async function writeHomeWorkerConfigFile(
  userDataPath: string,
  config: HomeWorkerConfigFile,
  dependencies: HomeWorkerConfigFileWriteDependencies = {},
): Promise<void> {
  await writeTextFileAtomically(
    resolveHomeWorkerConfigPath(userDataPath),
    `${JSON.stringify(config)}\n`,
    dependencies,
  )
}

const configMutationQueues = new Map<string, SerialOperationQueue>()

export async function mutateHomeWorkerConfigFile(input: {
  userDataPath: string
  configOptions?: HomeWorkerConfigModeOptions
  expectedUpdatedAt?: string | null
  mutate: (previous: HomeWorkerConfigFile) => HomeWorkerConfigFile | Promise<HomeWorkerConfigFile>
  now?: () => Date
  writeDependencies?: HomeWorkerConfigFileWriteDependencies
}): Promise<HomeWorkerConfigFile> {
  const queueKey = resolveHomeWorkerConfigPath(input.userDataPath)
  const operations = configMutationQueues.get(queueKey) ?? createSerialOperationQueue()
  configMutationQueues.set(queueKey, operations)
  const operation = operations.run(async () => {
    const previous = await readHomeWorkerConfigFile(input.userDataPath, input.configOptions)
    if (input.expectedUpdatedAt !== undefined && previous.updatedAt !== input.expectedUpdatedAt) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Home worker config revision is stale.',
      })
    }

    const candidate = await input.mutate(previous)
    const next: HomeWorkerConfigFile = {
      ...candidate,
      updatedAt: createNextConfigRevision(previous.updatedAt, input.now?.() ?? new Date()),
    }
    await writeHomeWorkerConfigFile(input.userDataPath, next, input.writeDependencies)
    return next
  })
  return await operation
}
