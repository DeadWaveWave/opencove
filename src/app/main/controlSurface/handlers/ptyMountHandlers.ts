import process from 'node:process'
import { fromFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError, OpenCoveAppError } from '../../../../shared/errors/appError'
import type {
  SpawnTerminalInMountInput,
  SpawnTerminalInput,
  SpawnTerminalResult,
} from '../../../../shared/contracts/dto'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import type { ControlSurface } from '../controlSurface'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'

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

function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }

  return normalized
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

function normalizeFileSystemUri(uri: unknown, operationId: string): string {
  if (typeof uri !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  const normalized = uri.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} uri.`,
    })
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  if (parsed.protocol !== 'file:') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unsupported uri scheme for ${operationId}: ${parsed.protocol}`,
    })
  }

  return normalized
}

function normalizeSpawnInMountPayload(payload: unknown): SpawnTerminalInMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for pty.spawnInMount.',
    })
  }

  return {
    mountId: normalizeRequiredString(payload.mountId, 'pty.spawnInMount mountId'),
    cwdUri:
      payload.cwdUri === undefined || payload.cwdUri === null
        ? null
        : normalizeFileSystemUri(payload.cwdUri, 'pty.spawnInMount cwdUri'),
    profileId: normalizeOptionalString(payload.profileId),
    shell: normalizeOptionalString(payload.shell),
    cols: normalizeOptionalPositiveInt(payload.cols),
    rows: normalizeOptionalPositiveInt(payload.rows),
  }
}

function resolvePathFromUriOrThrow(uri: string, operationId: string): string {
  const resolved = fromFileUri(uri)
  if (!resolved) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return resolved
}

async function invokeRemoteValue<TResult>(options: {
  endpoint: { hostname: string; port: number; token: string }
  id: string
  kind: 'query' | 'command'
  payload: unknown
}): Promise<TResult> {
  try {
    const { result } = await invokeControlSurface(options.endpoint, {
      kind: options.kind,
      id: options.id,
      payload: options.payload,
    })

    if (!result) {
      throw createAppError('worker.unavailable')
    }

    if (result.ok === false) {
      throw createAppError(result.error)
    }

    return result.value as TResult
  } catch (error) {
    if (error instanceof OpenCoveAppError) {
      throw error
    }

    throw createAppError('worker.unavailable', {
      debugMessage: error instanceof Error ? `${error.name}: ${error.message}` : undefined,
    })
  }
}

export function registerPtyMountHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
  },
): void {
  controlSurface.register('pty.spawnInMount', {
    kind: 'command',
    validate: normalizeSpawnInMountPayload,
    handle: async (ctx, payload): Promise<SpawnTerminalResult> => {
      const target = await deps.topology.resolveMountTarget({ mountId: payload.mountId })
      if (!target) {
        throw createAppError('common.invalid_input', {
          debugMessage: `Unknown mountId: ${payload.mountId}`,
        })
      }

      const cwdUri = payload.cwdUri ?? target.rootUri
      assertFileUriWithinRootUri({
        rootUri: target.rootUri,
        uri: cwdUri,
        debugMessage: 'pty.spawnInMount cwdUri is outside mount root',
      })

      const cwd = resolvePathFromUriOrThrow(cwdUri, 'pty.spawnInMount cwdUri')
      const cols = payload.cols ?? 80
      const rows = payload.rows ?? 24
      const profileId = normalizeOptionalString(payload.profileId)
      const shell = normalizeOptionalString(payload.shell)

      const startedAt = ctx.now().toISOString()

      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(cwd)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'pty.spawnInMount cwd is outside approved roots',
          })
        }

        const command = shell ?? resolveDefaultShell()
        const { sessionId } = await deps.ptyRuntime.spawnSession({
          cwd,
          cols,
          rows,
          command,
          args: [],
        })

        deps.ptyStreamHub.registerSessionMetadata({
          sessionId,
          kind: 'terminal',
          startedAt,
          cwd,
          command,
          args: [],
        })

        return {
          sessionId,
          profileId,
          runtimeKind: process.platform === 'win32' ? 'windows' : 'posix',
        }
      }

      const endpoint = await deps.topology.resolveRemoteEndpointConnection(target.endpointId)
      if (!endpoint) {
        throw createAppError('worker.unavailable', {
          debugMessage: `Remote endpoint unavailable: ${target.endpointId}`,
        })
      }

      const remoteSpawnPayload: SpawnTerminalInput = {
        cwd,
        cols,
        rows,
        ...(profileId ? { profileId } : {}),
        ...(shell ? { shell } : {}),
      }

      const remoteResult = await invokeRemoteValue<SpawnTerminalResult>({
        endpoint,
        kind: 'command',
        id: 'pty.spawn',
        payload: remoteSpawnPayload,
      })

      const remoteSessionId = normalizeOptionalString(remoteResult.sessionId)
      if (!remoteSessionId) {
        throw createAppError('worker.unavailable', {
          debugMessage: 'Remote pty.spawn returned an invalid session id.',
        })
      }

      const homeSessionId = deps.ptyRuntime.registerRemoteSession({
        endpointId: target.endpointId,
        remoteSessionId,
      })

      deps.ptyStreamHub.registerSessionMetadata({
        sessionId: homeSessionId,
        kind: 'terminal',
        startedAt,
        cwd,
        command: shell ?? 'shell',
        args: [],
      })

      return {
        sessionId: homeSessionId,
        profileId: remoteResult.profileId ?? profileId,
        runtimeKind: remoteResult.runtimeKind,
      }
    },
    defaultErrorCode: 'terminal.spawn_failed',
  })
}
