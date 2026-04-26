import type { ControlSurfaceOperationKind } from '../../../../shared/contracts/controlSurface'
import type {
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalResult,
  SpawnTerminalResult,
  TerminalRuntimeKind,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { PTY_STREAM_WS_PATH } from '../ptyStream/ptyStreamService'
import type {
  ControlSurfaceRemoteEndpoint,
  ControlSurfaceRemoteEndpointResolver,
} from './controlSurfaceHttpClient'
import { invokeControlSurface } from './controlSurfaceHttpClient'

export function resolveRemotePtyWsUrl(endpoint: { hostname: string; port: number }): string {
  return `ws://${endpoint.hostname}:${endpoint.port}${PTY_STREAM_WS_PATH}`
}

async function resolveEndpointOrThrow(
  endpointResolver: ControlSurfaceRemoteEndpointResolver,
): Promise<ControlSurfaceRemoteEndpoint> {
  const endpoint = await endpointResolver()
  if (!endpoint) {
    throw createAppError('worker.unavailable')
  }

  return endpoint
}

export async function invokeRemoteControlSurfaceValue<TResult>(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  kind: ControlSurfaceOperationKind
  id: string
  payload: unknown
  errorMessage: string
}): Promise<TResult> {
  const endpoint = await resolveEndpointOrThrow(options.endpointResolver)
  const { httpStatus, result } = await invokeControlSurface(endpoint, {
    kind: options.kind,
    id: options.id,
    payload: options.payload,
  })

  if (httpStatus !== 200 || !result || result.ok !== true) {
    throw new Error(options.errorMessage)
  }

  return result.value as TResult
}

export function parseSpawnTerminalResult(value: unknown): SpawnTerminalResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid pty.spawn response payload')
  }

  const record = value as Record<string, unknown>
  const sessionIdRaw = record.sessionId
  if (typeof sessionIdRaw !== 'string') {
    throw new Error('Invalid pty.spawn response payload')
  }

  const runtimeKindRaw = record.runtimeKind
  const runtimeKind =
    runtimeKindRaw === 'windows' || runtimeKindRaw === 'wsl' || runtimeKindRaw === 'posix'
      ? (runtimeKindRaw as SpawnTerminalResult['runtimeKind'])
      : undefined

  return {
    sessionId: sessionIdRaw.trim(),
    profileId: typeof record.profileId === 'string' ? record.profileId : null,
    runtimeKind,
  }
}

function parseTerminalRuntimeKind(value: unknown): TerminalRuntimeKind | null {
  return value === 'windows' || value === 'wsl' || value === 'posix' ? value : null
}

export function parseListTerminalProfilesResult(value: unknown): ListTerminalProfilesResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid pty.listProfiles response payload')
  }

  const record = value as Record<string, unknown>
  const rawProfiles = Array.isArray(record.profiles) ? record.profiles : []
  const profiles = rawProfiles.flatMap(profile => {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return []
    }

    const entry = profile as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const runtimeKind = parseTerminalRuntimeKind(entry.runtimeKind)

    if (id.length === 0 || label.length === 0 || runtimeKind === null) {
      return []
    }

    return [{ id, label, runtimeKind }]
  })

  const defaultProfileId =
    typeof record.defaultProfileId === 'string' && record.defaultProfileId.trim().length > 0
      ? record.defaultProfileId.trim()
      : null

  return {
    profiles,
    defaultProfileId,
  }
}

export function parseSnapshotScrollback(value: unknown): {
  scrollback: string
  toSeq: number | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid session.snapshot response payload')
  }

  const record = value as Record<string, unknown>
  return {
    scrollback: typeof record.scrollback === 'string' ? record.scrollback : '',
    toSeq:
      typeof record.toSeq === 'number' && Number.isFinite(record.toSeq)
        ? Math.floor(record.toSeq)
        : null,
  }
}

export function parsePresentationSnapshot(
  sessionId: string,
  value: unknown,
): PresentationSnapshotTerminalResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid session.presentationSnapshot response payload')
  }

  const record = value as Record<string, unknown>
  return {
    sessionId,
    epoch:
      typeof record.epoch === 'number' && Number.isFinite(record.epoch)
        ? Math.floor(record.epoch)
        : 1,
    appliedSeq:
      typeof record.appliedSeq === 'number' && Number.isFinite(record.appliedSeq)
        ? Math.floor(record.appliedSeq)
        : 0,
    presentationRevision:
      typeof record.presentationRevision === 'number' &&
      Number.isFinite(record.presentationRevision)
        ? Math.floor(record.presentationRevision)
        : 0,
    cols:
      typeof record.cols === 'number' && Number.isFinite(record.cols)
        ? Math.floor(record.cols)
        : 80,
    rows:
      typeof record.rows === 'number' && Number.isFinite(record.rows)
        ? Math.floor(record.rows)
        : 24,
    bufferKind:
      record.bufferKind === 'normal' ||
      record.bufferKind === 'alternate' ||
      record.bufferKind === 'unknown'
        ? record.bufferKind
        : 'unknown',
    cursor:
      record.cursor && typeof record.cursor === 'object' && !Array.isArray(record.cursor)
        ? {
            x:
              typeof (record.cursor as { x?: unknown }).x === 'number' &&
              Number.isFinite((record.cursor as { x?: number }).x)
                ? Math.floor((record.cursor as { x: number }).x)
                : 0,
            y:
              typeof (record.cursor as { y?: unknown }).y === 'number' &&
              Number.isFinite((record.cursor as { y?: number }).y)
                ? Math.floor((record.cursor as { y: number }).y)
                : 0,
          }
        : { x: 0, y: 0 },
    title: typeof record.title === 'string' ? record.title : null,
    serializedScreen: typeof record.serializedScreen === 'string' ? record.serializedScreen : '',
  }
}
