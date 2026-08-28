import type {
  GetSessionPresentationSnapshotInput,
  GetSessionSnapshotInput,
  SpawnTerminalInput,
  SpawnTerminalSessionInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { normalizeEnvPayload } from '../../ipc/normalize'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRequiredString(value: unknown, debugName: string): string {
  if (typeof value !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${debugName}.`,
    })
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${debugName}.`,
    })
  }
  return trimmed
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

function normalizeOptionalArgs(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null
  }
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    return null
  }
  return value
}

export function normalizeSnapshotPayload(payload: unknown): GetSessionSnapshotInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.snapshot.',
    })
  }
  return { sessionId: normalizeRequiredString(payload.sessionId, 'session.snapshot sessionId') }
}

export function normalizePresentationSnapshotPayload(
  payload: unknown,
): GetSessionPresentationSnapshotInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.presentationSnapshot.',
    })
  }
  return {
    sessionId: normalizeRequiredString(payload.sessionId, 'session.presentationSnapshot sessionId'),
  }
}

export function normalizeSpawnTerminalPayload(payload: unknown): SpawnTerminalSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.spawnTerminal.',
    })
  }
  const spaceId = normalizeRequiredString(payload.spaceId, 'session.spawnTerminal spaceId')
  const runtime = payload.runtime === 'shell' || payload.runtime === 'node' ? payload.runtime : null
  const command = normalizeOptionalString(payload.command)
  const args = normalizeOptionalArgs(payload.args)
  const cols = normalizeOptionalPositiveInt(payload.cols)
  const rows = normalizeOptionalPositiveInt(payload.rows)
  return {
    spaceId,
    ...(runtime ? { runtime } : {}),
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(cols ? { cols } : {}),
    ...(rows ? { rows } : {}),
  }
}

export function normalizePtySpawnPayload(payload: unknown): SpawnTerminalInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid payload for pty.spawn.' })
  }
  const workspaceId =
    payload.workspaceId === undefined
      ? null
      : normalizeRequiredString(payload.workspaceId, 'pty.spawn workspaceId')
  const profileId = normalizeOptionalString(payload.profileId)
  const shell = normalizeOptionalString(payload.shell)
  const command = normalizeOptionalString(payload.command)
  const args = normalizeOptionalArgs(payload.args)
  const env = normalizeEnvPayload(payload.env)
  return {
    cwd: normalizeRequiredString(payload.cwd, 'pty.spawn cwd'),
    ...(workspaceId ? { workspaceId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(shell ? { shell } : {}),
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    cols: normalizeOptionalPositiveInt(payload.cols) ?? 80,
    rows: normalizeOptionalPositiveInt(payload.rows) ?? 24,
  }
}
