import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  AttachTerminalInput,
  DetachTerminalInput,
  KillTerminalInput,
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

export function registerPtyIpcHandlers(
  runtime: PtyRuntime,
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
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

      return runtime.spawnSession(normalized)
    },
    { defaultErrorCode: 'terminal.spawn_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyWrite,
    async (_event, payload: WriteTerminalInput) => {
      const normalized = normalizeWriteTerminalPayload(payload)
      runtime.write(normalized.sessionId, normalized.data)
    },
    { defaultErrorCode: 'terminal.write_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyResize,
    async (_event, payload: ResizeTerminalInput) => {
      const normalized = normalizeResizeTerminalPayload(payload)
      runtime.resize(normalized.sessionId, normalized.cols, normalized.rows)
    },
    { defaultErrorCode: 'terminal.resize_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyKill,
    async (_event, payload: KillTerminalInput) => {
      const normalized = normalizeKillTerminalPayload(payload)
      runtime.kill(normalized.sessionId)
    },
    { defaultErrorCode: 'terminal.kill_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyAttach,
    async (event, payload: AttachTerminalInput) => {
      const normalized = normalizeAttachTerminalPayload(payload)
      runtime.attach(event.sender.id, normalized.sessionId)
    },
    { defaultErrorCode: 'terminal.attach_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyDetach,
    async (event, payload: DetachTerminalInput) => {
      const normalized = normalizeDetachTerminalPayload(payload)
      runtime.detach(event.sender.id, normalized.sessionId)
    },
    { defaultErrorCode: 'terminal.detach_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptySnapshot,
    async (_event, payload: SnapshotTerminalInput): Promise<SnapshotTerminalResult> => {
      const normalized = normalizeSnapshotPayload(payload)
      return { data: runtime.snapshot(normalized.sessionId) }
    },
    { defaultErrorCode: 'terminal.snapshot_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.ptySpawn)
      ipcMain.removeHandler(IPC_CHANNELS.ptyWrite)
      ipcMain.removeHandler(IPC_CHANNELS.ptyResize)
      ipcMain.removeHandler(IPC_CHANNELS.ptyKill)
      ipcMain.removeHandler(IPC_CHANNELS.ptyAttach)
      ipcMain.removeHandler(IPC_CHANNELS.ptyDetach)
      ipcMain.removeHandler(IPC_CHANNELS.ptySnapshot)

      runtime.dispose()
    },
  }
}
