import type {
  AttachTerminalInput,
  DetachTerminalInput,
  KillTerminalInput,
  ResizeTerminalInput,
  SpawnTerminalInput,
  SnapshotTerminalInput,
  TerminalWriteEncoding,
  WriteTerminalInput,
} from '../../../../shared/contracts/dto'
import { isAbsolute } from 'node:path'
import { createAppError } from '../../../../shared/errors/appError'

export function normalizeSpawnTerminalPayload(payload: unknown): SpawnTerminalInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for pty:spawn',
    })
  }

  const record = payload as Record<string, unknown>
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
  const profileId = typeof record.profileId === 'string' ? record.profileId.trim() : ''
  const shell = typeof record.shell === 'string' ? record.shell.trim() : ''

  const cols =
    typeof record.cols === 'number' && Number.isFinite(record.cols) && record.cols > 0
      ? Math.floor(record.cols)
      : 80
  const rows =
    typeof record.rows === 'number' && Number.isFinite(record.rows) && record.rows > 0
      ? Math.floor(record.rows)
      : 24

  if (cwd.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid cwd for pty:spawn',
    })
  }

  if (!isAbsolute(cwd)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'pty:spawn requires an absolute cwd',
    })
  }

  return {
    cwd,
    profileId: profileId.length > 0 ? profileId : undefined,
    shell: shell.length > 0 ? shell : undefined,
    cols,
    rows,
  }
}

function normalizeSessionId(payload: unknown, channel: string): string {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${channel}`,
    })
  }

  const record = payload as Record<string, unknown>
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  if (sessionId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid sessionId for ${channel}`,
    })
  }

  return sessionId
}

export function normalizeWriteTerminalPayload(payload: unknown): WriteTerminalInput {
  const sessionId = normalizeSessionId(payload, 'pty:write')
  const record = payload as Record<string, unknown>
  const data = typeof record.data === 'string' ? record.data : ''
  const rawEncoding = record.encoding

  if (rawEncoding !== undefined && rawEncoding !== 'utf8' && rawEncoding !== 'binary') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid encoding for pty:write',
    })
  }

  const encoding: TerminalWriteEncoding = rawEncoding === 'binary' ? 'binary' : 'utf8'
  return { sessionId, data, encoding }
}

export function normalizeResizeTerminalPayload(payload: unknown): ResizeTerminalInput {
  const sessionId = normalizeSessionId(payload, 'pty:resize')
  const record = payload as Record<string, unknown>
  const cols =
    typeof record.cols === 'number' && Number.isFinite(record.cols) && record.cols > 0
      ? Math.floor(record.cols)
      : 80
  const rows =
    typeof record.rows === 'number' && Number.isFinite(record.rows) && record.rows > 0
      ? Math.floor(record.rows)
      : 24
  return { sessionId, cols, rows }
}

export function normalizeKillTerminalPayload(payload: unknown): KillTerminalInput {
  return { sessionId: normalizeSessionId(payload, 'pty:kill') }
}

export function normalizeAttachTerminalPayload(payload: unknown): AttachTerminalInput {
  return { sessionId: normalizeSessionId(payload, 'pty:attach') }
}

export function normalizeDetachTerminalPayload(payload: unknown): DetachTerminalInput {
  return { sessionId: normalizeSessionId(payload, 'pty:detach') }
}

export function normalizeSnapshotPayload(payload: unknown): SnapshotTerminalInput {
  return { sessionId: normalizeSessionId(payload, 'pty:snapshot') }
}
