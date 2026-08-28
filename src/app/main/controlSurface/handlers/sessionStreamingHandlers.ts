import process from 'node:process'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import { TerminalProfileResolver } from '../../../../platform/terminal/TerminalProfileResolver'
import { createAppError } from '../../../../shared/errors/appError'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type {
  GetSessionPresentationSnapshotResult,
  GetSessionSnapshotResult,
  ListTerminalProfilesResult,
  ListSessionsResult,
  SpawnTerminalResult,
  SpawnTerminalSessionResult,
} from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { TerminalSpawnAdmission } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import { resolveExecutionContextDto, resolveSessionLaunchSpawn } from './sessionLaunchSupport'
import { resolveSpaceWorkingDirectoryFromStore } from './resolveSpaceWorkingDirectoryFromStore'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import type { TerminalAgentActivityEnvironmentService } from '../../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { spawnTerminalWithActivity } from './terminalAgentActivitySpawn'
import {
  normalizePresentationSnapshotPayload,
  normalizePtySpawnPayload,
  normalizeSnapshotPayload,
  normalizeSpawnTerminalPayload,
} from './sessionStreamingPayloads'

const terminalProfileResolver = new TerminalProfileResolver()

async function invokeInternalCommand<TResult>(
  controlSurface: ControlSurface,
  ctx: Parameters<ControlSurface['invoke']>[0],
  request: { id: string; payload: unknown },
): Promise<TResult> {
  const result = await controlSurface.invoke(ctx, {
    kind: 'command',
    id: request.id,
    payload: request.payload,
  })

  if (result.ok === false) {
    throw createAppError(result.error)
  }

  return result.value as TResult
}

export function registerSessionStreamingHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: ControlSurfacePtyRuntime
    ptyStreamHub: PtyStreamHub
    topology: WorkerTopologyStore
    terminalSpawnAdmission: TerminalSpawnAdmission
    terminalAgentActivity?: TerminalAgentActivityEnvironmentService
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

  controlSurface.register('session.presentationSnapshot', {
    kind: 'query',
    validate: normalizePresentationSnapshotPayload,
    handle: async (_ctx, payload): Promise<GetSessionPresentationSnapshotResult> => {
      try {
        return await deps.ptyStreamHub.presentationSnapshotSession(payload.sessionId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown session'
        throw createAppError('session.not_found', {
          debugMessage: `session.presentationSnapshot: ${message}`,
        })
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('session.spawnTerminal', {
    kind: 'command',
    validate: normalizeSpawnTerminalPayload,
    handle: async (ctx, payload): Promise<SpawnTerminalSessionResult> => {
      const {
        workingDirectory,
        agentSettings,
        projectId,
        directoryPath,
        targetMountId,
        boundary,
        workspacePath,
      } = await resolveSpaceWorkingDirectoryFromStore({
        spaceId: payload.spaceId,
        getPersistenceStore: deps.getPersistenceStore,
      })

      deps.terminalSpawnAdmission.assertSpawnAllowed(projectId, ctx.terminalRecoverySpawnScope)

      const mountContext = resolveSpaceMountContext({
        space: { directoryPath, targetMountId, boundary },
        workspacePath,
        mounts: (await deps.topology.listMounts({ projectId })).mounts,
      })

      if (mountContext.mount) {
        const runtime = payload.runtime ?? 'shell'
        const spawnCommand = payload.command ?? (runtime === 'node' ? 'node' : null)
        const cwdUri =
          mountContext.workingDirectory.trim().length > 0
            ? toFileUri(mountContext.workingDirectory)
            : null

        const spawned = await invokeInternalCommand<SpawnTerminalResult>(controlSurface, ctx, {
          id: 'pty.spawnInMount',
          payload: {
            mountId: mountContext.mount.mountId,
            cwdUri,
            profileId: agentSettings.defaultTerminalProfileId,
            ...(spawnCommand ? { command: spawnCommand } : {}),
            ...(spawnCommand && payload.args ? { args: payload.args } : {}),
            cols: payload.cols,
            rows: payload.rows,
          },
        })

        const session =
          deps.ptyStreamHub
            .listSessions()
            .sessions.find(item => item.sessionId === spawned.sessionId) ?? null

        return {
          sessionId: spawned.sessionId,
          startedAt: session?.startedAt ?? ctx.now().toISOString(),
          cwd: session?.cwd ?? mountContext.workingDirectory,
          command: session?.command ?? spawnCommand ?? resolveDefaultShell(),
          args: session?.args ?? (spawnCommand ? (payload.args ?? []) : []),
          executionContext: resolveExecutionContextDto(
            session?.cwd ?? mountContext.workingDirectory,
            {
              projectId,
              spaceId: payload.spaceId,
              mountId: mountContext.mount.mountId,
              targetId: mountContext.mount.targetId,
              endpointId: mountContext.mount.endpointId,
              endpointKind: mountContext.mount.endpointId === 'local' ? 'local' : 'remote_worker',
              targetRootPath: mountContext.mount.rootPath,
              targetRootUri: mountContext.mount.rootUri,
              scopeRootPath: mountContext.scope?.rootPath ?? mountContext.mount.rootPath,
              scopeRootUri: mountContext.scope?.rootUri ?? mountContext.mount.rootUri,
            },
          ),
        }
      }

      const isApproved = await deps.approvedWorkspaces.isPathApproved(workingDirectory)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'session.spawnTerminal workingDirectory is outside approved roots',
        })
      }

      const cols = payload.cols ?? 80
      const rows = payload.rows ?? 24

      const runtime = payload.runtime ?? 'shell'
      const spawnCommand =
        payload.command ??
        (runtime === 'node' ? (process.platform === 'win32' ? 'node.exe' : 'node') : null)
      const spawnArgs = payload.command ? (payload.args ?? []) : []

      const resolvedSpawn = spawnCommand
        ? await resolveSessionLaunchSpawn({
            workingDirectory,
            defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
            command: spawnCommand,
            args: spawnArgs,
          })
        : await terminalProfileResolver.resolveTerminalSpawn({
            cwd: workingDirectory,
            profileId: agentSettings.defaultTerminalProfileId ?? undefined,
            cols,
            rows,
          })

      const { sessionId } = await spawnTerminalWithActivity(deps.ptyRuntime, {
        activity: deps.terminalAgentActivity,
        args: resolvedSpawn.args,
        cols,
        command: resolvedSpawn.command,
        cwd: resolvedSpawn.cwd,
        env: resolvedSpawn.env,
        interactiveShell: !spawnCommand,
        rows,
      })

      const startedAt = ctx.now().toISOString()
      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'terminal',
        startedAt,
        cwd: resolvedSpawn.cwd,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        cols,
        rows,
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

  controlSurface.register('pty.listProfiles', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: async (): Promise<ListTerminalProfilesResult> =>
      deps.ptyRuntime.listProfiles
        ? await deps.ptyRuntime.listProfiles()
        : { profiles: [], defaultProfileId: null },
    defaultErrorCode: 'terminal.spawn_failed',
  })

  controlSurface.register('pty.spawn', {
    kind: 'command',
    validate: normalizePtySpawnPayload,
    handle: async (ctx, payload): Promise<SpawnTerminalResult> => {
      deps.terminalSpawnAdmission.assertSpawnAllowed(
        payload.workspaceId ?? null,
        ctx.terminalRecoverySpawnScope,
      )
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'pty.spawn cwd is outside approved roots',
        })
      }

      const resolvedSpawn = payload.command
        ? await resolveSessionLaunchSpawn({
            workingDirectory: payload.cwd,
            defaultTerminalProfileId: payload.profileId ?? null,
            command: payload.command,
            args: payload.args ?? [],
            ...(payload.env ? { env: payload.env } : {}),
          })
        : await terminalProfileResolver.resolveTerminalSpawn({
            cwd: payload.cwd,
            profileId: payload.profileId,
            shell: payload.shell,
            cols: payload.cols,
            rows: payload.rows,
            ...(payload.env ? { env: payload.env } : {}),
          })

      const { sessionId } = await spawnTerminalWithActivity(deps.ptyRuntime, {
        activity: deps.terminalAgentActivity,
        args: resolvedSpawn.args,
        cols: payload.cols,
        command: resolvedSpawn.command,
        cwd: resolvedSpawn.cwd,
        env: resolvedSpawn.env,
        interactiveShell: !payload.command,
        rows: payload.rows,
      })

      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'terminal',
        startedAt: new Date().toISOString(),
        cwd: resolvedSpawn.cwd,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        cols: payload.cols,
        rows: payload.rows,
      })

      return {
        sessionId,
        profileId: resolvedSpawn.profileId,
        runtimeKind: resolvedSpawn.runtimeKind,
      }
    },
    defaultErrorCode: 'terminal.spawn_failed',
  })

  if (deps.ptyRuntime.debugCrashHost) {
    controlSurface.register('pty.debugCrashHost', {
      kind: 'command',
      validate: payload => payload ?? null,
      handle: async () => {
        const sessionIds = deps.ptyStreamHub
          .listSessions()
          .sessions.map(session => session.sessionId)
        await deps.ptyRuntime.debugCrashHost?.()
        await Promise.allSettled(
          sessionIds.map(async sessionId => {
            await Promise.resolve(deps.ptyRuntime.kill(sessionId))
          }),
        )
        sessionIds.forEach(sessionId => {
          deps.ptyStreamHub.handlePtyExit(sessionId, 1)
        })
        return null
      },
      defaultErrorCode: 'common.unexpected',
    })
  }
}
