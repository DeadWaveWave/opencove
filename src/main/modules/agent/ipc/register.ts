import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/constants/ipc'
import type {
  LaunchAgentInput,
  LaunchAgentResult,
  ListAgentModelsInput,
} from '../../../../shared/types/api'
import type { IpcRegistrationDisposable } from '../../../ipc/types'
import { buildAgentLaunchCommand } from '../../../infrastructure/agent/AgentCommandFactory'
import { listAgentModels } from '../../../infrastructure/agent/AgentModelService'
import { locateAgentResumeSessionId } from '../../../infrastructure/agent/AgentSessionLocator'
import type { PtyRuntime } from '../../pty/ipc/runtime'
import type { ApprovedWorkspaceStore } from '../../workspace/ApprovedWorkspaceStore'
import {
  normalizeLaunchAgentPayload,
  normalizeListModelsPayload,
  resolveAgentTestStub,
} from './validate'

export function registerAgentIpcHandlers(
  ptyRuntime: PtyRuntime,
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  ipcMain.handle(IPC_CHANNELS.agentListModels, async (_event, payload: ListAgentModelsInput) => {
    const normalized = normalizeListModelsPayload(payload)
    return await listAgentModels(normalized.provider)
  })

  ipcMain.handle(IPC_CHANNELS.agentLaunch, async (_event, payload: LaunchAgentInput) => {
    const normalized = normalizeLaunchAgentPayload(payload)

    const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
    if (!isApproved) {
      throw new Error('agent:launch cwd is outside approved workspaces')
    }

    const launchCommand = buildAgentLaunchCommand({
      provider: normalized.provider,
      mode: normalized.mode ?? 'new',
      prompt: normalized.prompt,
      model: normalized.model ?? null,
      resumeSessionId: normalized.resumeSessionId ?? null,
    })

    const testStub = resolveAgentTestStub(
      normalized.provider,
      launchCommand.effectiveModel,
      normalized.mode,
    )

    const launchStartedAtMs = Date.now()

    const { sessionId } = ptyRuntime.spawnSession({
      cwd: normalized.cwd,
      cols: normalized.cols ?? 80,
      rows: normalized.rows ?? 24,
      command: testStub?.command ?? launchCommand.command,
      args: testStub?.args ?? launchCommand.args,
    })

    let resumeSessionId = launchCommand.resumeSessionId

    if (process.env.NODE_ENV !== 'test') {
      const shouldDetectResumeSession =
        launchCommand.launchMode === 'new' ||
        (launchCommand.launchMode === 'resume' && resumeSessionId === null)

      if (shouldDetectResumeSession) {
        const detectedSessionId = await locateAgentResumeSessionId({
          provider: normalized.provider,
          cwd: normalized.cwd,
          startedAtMs: launchStartedAtMs,
        })

        if (detectedSessionId) {
          resumeSessionId = detectedSessionId
        }
      }
    }

    if (process.env.NODE_ENV !== 'test') {
      ptyRuntime.startSessionStateWatcher({
        sessionId,
        provider: normalized.provider,
        cwd: normalized.cwd,
        resumeSessionId,
        startedAtMs: launchStartedAtMs,
      })
    }

    const result: LaunchAgentResult = {
      sessionId,
      provider: normalized.provider,
      command: launchCommand.command,
      args: launchCommand.args,
      launchMode: launchCommand.launchMode,
      effectiveModel: launchCommand.effectiveModel,
      resumeSessionId,
    }

    return result
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.agentListModels)
      ipcMain.removeHandler(IPC_CHANNELS.agentLaunch)
    },
  }
}
