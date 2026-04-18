import process from 'node:process'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  GetSessionSnapshotInput,
  GetSessionSnapshotResult,
  ListSessionsResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  SpawnTerminalSessionInput,
  SpawnTerminalSessionResult,
} from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import { resolveExecutionContextDto, resolveSessionLaunchSpawn } from './sessionLaunchSupport'
import { resolveSpaceWorkingDirectoryFromStore } from './resolveSpaceWorkingDirectoryFromStore'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'

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
  if (trimmed.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${debugName}.`,
    })
  }

  return trimmed
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

function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

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

  if (!Array.isArray(value)) {
    return null
  }

  const args: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      return null
    }

    args.push(item)
  }

  return args
}

function normalizeTerminalRuntime(value: unknown): 'shell' | 'node' | null {
  if (value === null || value === undefined) {
    return null
  }

  if (value === 'shell' || value === 'node') {
    return value
  }

  return null
}

function normalizeSnapshotPayload(payload: unknown): GetSessionSnapshotInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.snapshot.',
    })
  }

  return {
    sessionId: normalizeRequiredString(payload.sessionId, 'session.snapshot sessionId'),
  }
}

function normalizeSpawnTerminalPayload(payload: unknown): SpawnTerminalSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.spawnTerminal.',
    })
  }

  const spaceId = normalizeRequiredString(payload.spaceId, 'session.spawnTerminal spaceId')
  const runtime = normalizeTerminalRuntime(payload.runtime)
  const command = normalizeOptionalString(payload.command)
  const args = normalizeOptionalArgs(payload.args)
  const cols = normalizeOptionalPositiveInt(payload.cols)
  const rows = normalizeOptionalPositiveInt(payload.rows)

  return {
    spaceId,
    ...(runtime ? { runtime } : {}),
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(typeof cols === 'number' ? { cols } : {}),
    ...(typeof rows === 'number' ? { rows } : {}),
  }
}

function normalizePtySpawnPayload(payload: unknown): SpawnTerminalInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for pty.spawn.',
    })
  }

  const cwd = normalizeRequiredString(payload.cwd, 'pty.spawn cwd')
  const cols = normalizeOptionalPositiveInt(payload.cols) ?? 80
  const rows = normalizeOptionalPositiveInt(payload.rows) ?? 24
  const profileId = normalizeOptionalString(payload.profileId)
  const shell = normalizeOptionalString(payload.shell)

  return {
    cwd,
    ...(profileId ? { profileId } : {}),
    ...(shell ? { shell } : {}),
    cols,
    rows,
  }
}

export function registerSessionStreamingHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: ControlSurfacePtyRuntime
    ptyStreamHub: PtyStreamHub
  },
): void {
  controlSurface.register('session.list', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: (): ListSessionsResult => deps.ptyStreamHub.listSessions(),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('session.snapshot', {
    kind: 'query',
    validate: normalizeSnapshotPayload,
    handle: (_ctx, payload): GetSessionSnapshotResult => {
      try {
        return deps.ptyStreamHub.snapshotSession(payload.sessionId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown session'
        throw createAppError('session.not_found', {
          debugMessage: `session.snapshot: ${message}`,
        })
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('session.spawnTerminal', {
    kind: 'command',
    validate: normalizeSpawnTerminalPayload,
    handle: async (ctx, payload): Promise<SpawnTerminalSessionResult> => {
      const { workingDirectory, agentSettings, projectId } =
        await resolveSpaceWorkingDirectoryFromStore({
          spaceId: payload.spaceId,
          getPersistenceStore: deps.getPersistenceStore,
        })

      const isApproved = await deps.approvedWorkspaces.isPathApproved(workingDirectory)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'session.spawnTerminal workingDirectory is outside approved roots',
        })
      }

      const cols = payload.cols ?? 80
      const rows = payload.rows ?? 24

      const runtime = payload.runtime ?? 'shell'
      const fallbackCommand =
        runtime === 'node'
          ? process.platform === 'win32'
            ? 'node.exe'
            : 'node'
          : resolveDefaultShell()

      const spawnCommand = payload.command ?? fallbackCommand
      const spawnArgs = payload.command ? (payload.args ?? []) : []

      const resolvedSpawn = await resolveSessionLaunchSpawn({
        workingDirectory,
        defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
        command: spawnCommand,
        args: spawnArgs,
      })

      const { sessionId } = await deps.ptyRuntime.spawnSession({
        cwd: resolvedSpawn.cwd,
        cols,
        rows,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        ...(resolvedSpawn.env ? { env: resolvedSpawn.env } : {}),
      })

      const startedAt = ctx.now().toISOString()
      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'terminal',
        startedAt,
        cwd: resolvedSpawn.cwd,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
      })

      return {
        sessionId,
        startedAt,
        cwd: resolvedSpawn.cwd,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        executionContext: resolveExecutionContextDto(workingDirectory, {
          projectId,
          spaceId: payload.spaceId,
        }),
      }
    },
    defaultErrorCode: 'terminal.spawn_failed',
  })

  controlSurface.register('pty.spawn', {
    kind: 'command',
    validate: normalizePtySpawnPayload,
    handle: async (_ctx, payload): Promise<SpawnTerminalResult> => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'pty.spawn cwd is outside approved roots',
        })
      }

      const command = payload.shell ?? resolveDefaultShell()
      const { sessionId } = await deps.ptyRuntime.spawnSession({
        cwd: payload.cwd,
        cols: payload.cols,
        rows: payload.rows,
        command,
        args: [],
      })

      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'terminal',
        startedAt: new Date().toISOString(),
        cwd: payload.cwd,
        command,
        args: [],
      })

      return {
        sessionId,
        profileId: payload.profileId ?? null,
        runtimeKind: process.platform === 'win32' ? 'windows' : 'posix',
      }
    },
    defaultErrorCode: 'terminal.spawn_failed',
  })
}
