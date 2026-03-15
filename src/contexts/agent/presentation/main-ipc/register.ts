import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  LaunchAgentInput,
  LaunchAgentResult,
  ListAgentModelsInput,
  ReadAgentLastMessageResult,
  ResolveAgentResumeSessionInput,
  ResolveAgentResumeSessionResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { buildAgentLaunchCommand } from '../../infrastructure/cli/AgentCommandFactory'
import { resolveAgentCliInvocation } from '../../infrastructure/cli/AgentCliInvocation'
import {
  disposeAgentModelService,
  listAgentModels,
} from '../../infrastructure/cli/AgentModelService'
import { locateAgentResumeSessionId } from '../../infrastructure/cli/AgentSessionLocator'
import { readLastAssistantMessageFromSessionFile } from '../../infrastructure/watchers/SessionLastAssistantMessage'
import { resolveSessionFilePath } from '../../infrastructure/watchers/SessionFileResolver'
import type { PtyRuntime } from '../../../terminal/presentation/main-ipc/runtime'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import {
  normalizeLaunchAgentPayload,
  normalizeListModelsPayload,
  normalizeReadLastMessagePayload,
  normalizeResolveResumeSessionPayload,
  resolveAgentTestStub,
} from './validate'

const HYDRATE_RESUME_RESOLVE_TIMEOUT_MS = 3_000
const READ_LAST_MESSAGE_RESOLVE_TIMEOUT_MS = 1_500
const READ_LAST_MESSAGE_FILE_TIMEOUT_MS = 1_500

export function registerAgentIpcHandlers(
  ptyRuntime: PtyRuntime,
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  ipcMain.handle(IPC_CHANNELS.agentListModels, async (_event, payload: ListAgentModelsInput) => {
    const normalized = normalizeListModelsPayload(payload)
    return await listAgentModels(normalized.provider)
  })

  ipcMain.handle(
    IPC_CHANNELS.agentResolveResumeSession,
    async (
      _event,
      payload: ResolveAgentResumeSessionInput,
    ): Promise<ResolveAgentResumeSessionResult> => {
      const normalized = normalizeResolveResumeSessionPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw new Error('agent:resolve-resume-session cwd is outside approved workspaces')
      }

      const resumeSessionId = await locateAgentResumeSessionId({
        provider: normalized.provider,
        cwd: normalized.cwd,
        startedAtMs: Date.parse(normalized.startedAt),
        timeoutMs: HYDRATE_RESUME_RESOLVE_TIMEOUT_MS,
      })

      return { resumeSessionId }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.agentReadLastMessage,
    async (_event, payload): Promise<ReadAgentLastMessageResult> => {
      const normalized = normalizeReadLastMessagePayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw new Error('agent:read-last-message cwd is outside approved workspaces')
      }

      const startedAtMs = Date.parse(normalized.startedAt)
      const resumeSessionId =
        normalized.resumeSessionId ??
        (await locateAgentResumeSessionId({
          provider: normalized.provider,
          cwd: normalized.cwd,
          startedAtMs,
          timeoutMs: READ_LAST_MESSAGE_RESOLVE_TIMEOUT_MS,
        }))

      if (!resumeSessionId) {
        return { message: null }
      }

      const sessionFilePath = await resolveSessionFilePath({
        provider: normalized.provider,
        cwd: normalized.cwd,
        sessionId: resumeSessionId,
        startedAtMs,
        timeoutMs: READ_LAST_MESSAGE_FILE_TIMEOUT_MS,
      })

      if (!sessionFilePath) {
        return { message: null }
      }

      const message = await readLastAssistantMessageFromSessionFile(
        normalized.provider,
        sessionFilePath,
      )

      return { message }
    },
  )

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
      agentFullAccess: normalized.agentFullAccess ?? true,
    })

    const testStub = resolveAgentTestStub(
      normalized.provider,
      normalized.cwd,
      launchCommand.effectiveModel,
      normalized.mode,
    )

    const launchStartedAtMs = Date.now()
    const resolvedInvocation = await resolveAgentCliInvocation({
      command: testStub?.command ?? launchCommand.command,
      args: testStub?.args ?? launchCommand.args,
    })

    const { sessionId } = ptyRuntime.spawnSession({
      cwd: normalized.cwd,
      cols: normalized.cols ?? 80,
      rows: normalized.rows ?? 24,
      command: resolvedInvocation.command,
      args: resolvedInvocation.args,
    })

    const resumeSessionId = launchCommand.resumeSessionId

    const shouldStartStateWatcher =
      process.env.NODE_ENV !== 'test' ||
      process.env['OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER'] === '1'

    if (shouldStartStateWatcher) {
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
      command: resolvedInvocation.command,
      args: resolvedInvocation.args,
      launchMode: launchCommand.launchMode,
      effectiveModel: launchCommand.effectiveModel,
      resumeSessionId,
    }

    return result
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.agentListModels)
      ipcMain.removeHandler(IPC_CHANNELS.agentResolveResumeSession)
      ipcMain.removeHandler(IPC_CHANNELS.agentReadLastMessage)
      ipcMain.removeHandler(IPC_CHANNELS.agentLaunch)
      disposeAgentModelService()
    },
  }
}
