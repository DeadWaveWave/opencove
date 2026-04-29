import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  AttachTerminalInput,
  DetachTerminalInput,
  KillTerminalInput,
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalInput,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  SnapshotTerminalInput,
  SnapshotTerminalResult,
  SpawnTerminalInput,
  WriteTerminalInput,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PtyRuntime } from './runtime'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import {
  normalizeAttachTerminalPayload,
  normalizeDetachTerminalPayload,
  normalizeKillTerminalPayload,
  normalizeResizeTerminalPayload,
  normalizeSnapshotPayload,
  normalizeSpawnTerminalPayload,
  normalizeWriteTerminalPayload,
} from './validate'
import { createAppError } from '../../../../shared/errors/appError'
import { isDebugCrashHostEnabled } from './debugCrashHost'

export function registerPtyIpcHandlers(
  runtime: PtyRuntime,
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.ptyListProfiles,
    async (): Promise<ListTerminalProfilesResult> =>
      runtime.listProfiles
        ? await runtime.listProfiles()
        : { profiles: [], defaultProfileId: null },
    { defaultErrorCode: 'terminal.spawn_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptySpawn,
    async (_event, payload: SpawnTerminalInput) => {
      const normalized = normalizeSpawnTerminalPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'pty:spawn cwd is outside approved workspaces',
        })
      }

      if (runtime.spawnTerminalSession) {
        return await runtime.spawnTerminalSession(normalized)
      }

      return await runtime.spawnSession(normalized as SpawnPtyOptions)
    },
    { defaultErrorCode: 'terminal.spawn_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyWrite,
    async (_event, payload: WriteTerminalInput) => {
      const normalized = normalizeWriteTerminalPayload(payload)
      await runtime.write(normalized.sessionId, normalized.data, normalized.encoding)
    },
    { defaultErrorCode: 'terminal.write_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyResize,
    async (_event, payload: ResizeTerminalInput) => {
      const normalized = normalizeResizeTerminalPayload(payload)
      await runtime.resize(
        normalized.sessionId,
        normalized.cols,
        normalized.rows,
        normalized.reason,
      )
    },
    { defaultErrorCode: 'terminal.resize_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyKill,
    async (_event, payload: KillTerminalInput) => {
      const normalized = normalizeKillTerminalPayload(payload)
      await runtime.kill(normalized.sessionId)
    },
    { defaultErrorCode: 'terminal.kill_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyAttach,
    async (event, payload: AttachTerminalInput) => {
      const normalized = normalizeAttachTerminalPayload(payload)
      await runtime.attach(event.sender.id, normalized.sessionId, normalized.afterSeq)
    },
    { defaultErrorCode: 'terminal.attach_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyDetach,
    async (event, payload: DetachTerminalInput) => {
      const normalized = normalizeDetachTerminalPayload(payload)
      await runtime.detach(event.sender.id, normalized.sessionId)
    },
    { defaultErrorCode: 'terminal.detach_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptySnapshot,
    async (_event, payload: SnapshotTerminalInput): Promise<SnapshotTerminalResult> => {
      const normalized = normalizeSnapshotPayload(payload)
      return { data: await runtime.snapshot(normalized.sessionId) }
    },
    { defaultErrorCode: 'terminal.snapshot_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyPresentationSnapshot,
    async (
      _event,
      payload: PresentationSnapshotTerminalInput,
    ): Promise<PresentationSnapshotTerminalResult> => {
      const normalized = normalizeSnapshotPayload(payload)
      return await runtime.presentationSnapshot(normalized.sessionId)
    },
    { defaultErrorCode: 'terminal.snapshot_failed' },
  )

  if (isDebugCrashHostEnabled() && runtime.debugCrashHost) {
    registerHandledIpc(
      IPC_CHANNELS.ptyDebugCrashHost,
      async () => await runtime.debugCrashHost?.(),
      { defaultErrorCode: 'common.unexpected' },
    )
  }

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.ptySpawn)
      ipcMain.removeHandler(IPC_CHANNELS.ptyListProfiles)
      ipcMain.removeHandler(IPC_CHANNELS.ptyWrite)
      ipcMain.removeHandler(IPC_CHANNELS.ptyResize)
      ipcMain.removeHandler(IPC_CHANNELS.ptyKill)
      ipcMain.removeHandler(IPC_CHANNELS.ptyAttach)
      ipcMain.removeHandler(IPC_CHANNELS.ptyDetach)
      ipcMain.removeHandler(IPC_CHANNELS.ptySnapshot)
      ipcMain.removeHandler(IPC_CHANNELS.ptyPresentationSnapshot)
      ipcMain.removeHandler(IPC_CHANNELS.ptyDebugCrashHost)

      runtime.dispose()
    },
  }
}
