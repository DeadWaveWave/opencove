import { ipcMain } from 'electron'
import { createServer } from 'node:net'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  LaunchAgentInput,
  LaunchAgentResult,
  ListAgentModelsInput,
  ListInstalledAgentProvidersResult,
  ReadAgentLastMessageInput,
  ReadAgentLastMessageResult,
  ResolveAgentResumeSessionInput,
  ResolveAgentResumeSessionResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import { buildAgentLaunchCommand } from '../../infrastructure/cli/AgentCommandFactory'
import { resolveAgentCliInvocation } from '../../infrastructure/cli/AgentCliInvocation'
import { listInstalledAgentProviders } from '../../infrastructure/cli/AgentCliAvailability'
import {
  disposeAgentModelService,
  listAgentModels,
} from '../../infrastructure/cli/AgentModelService'
import { captureGeminiSessionDiscoveryCursor } from '../../infrastructure/cli/AgentSessionLocatorProviders'
import { locateAgentResumeSessionId } from '../../infrastructure/cli/AgentSessionLocator'
import {
  readLastAssistantMessageFromOpenCodeSession,
  readLastAssistantMessageFromSessionFile,
} from '../../infrastructure/watchers/SessionLastAssistantMessage'
import { resolveSessionFilePath } from '../../infrastructure/watchers/SessionFileResolver'
import { ensureOpenCodeEmbeddedTuiConfigPath } from '../../infrastructure/opencode/OpenCodeTuiConfig'
import type { PtyRuntime } from '../../../terminal/presentation/main-ipc/runtime'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import {
  normalizeLaunchAgentPayload,
  normalizeListModelsPayload,
  normalizeReadLastMessagePayload,
  normalizeResolveResumeSessionPayload,
  resolveAgentTestStub,
} from './validate'
import { createAppError } from '../../../../shared/errors/appError'

const HYDRATE_RESUME_RESOLVE_TIMEOUT_MS = 3_000
const READ_LAST_MESSAGE_RESOLVE_TIMEOUT_MS = 1_500
const READ_LAST_MESSAGE_FILE_TIMEOUT_MS = 1_500
const OPENCODE_SERVER_HOSTNAME = '127.0.0.1'

function normalizeOptionalEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

async function reserveLoopbackPort(hostname: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()

    server.once('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve local loopback port')))
        return
      }

      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

export function registerAgentIpcHandlers(
  ptyRuntime: PtyRuntime,
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.agentListInstalledProviders,
    async (): Promise<ListInstalledAgentProvidersResult> => ({
      providers: await listInstalledAgentProviders(),
    }),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentListModels,
    async (_event, payload: ListAgentModelsInput) => {
      const normalized = normalizeListModelsPayload(payload)
      return await listAgentModels(normalized.provider)
    },
    { defaultErrorCode: 'agent.list_models_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentResolveResumeSession,
    async (
      _event,
      payload: ResolveAgentResumeSessionInput,
    ): Promise<ResolveAgentResumeSessionResult> => {
      const normalized = normalizeResolveResumeSessionPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'agent:resolve-resume-session cwd is outside approved workspaces',
        })
      }

      const resumeSessionId = await locateAgentResumeSessionId({
        provider: normalized.provider,
        cwd: normalized.cwd,
        startedAtMs: Date.parse(normalized.startedAt),
        timeoutMs: HYDRATE_RESUME_RESOLVE_TIMEOUT_MS,
      })

      return { resumeSessionId }
    },
    { defaultErrorCode: 'agent.resume_session_resolve_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentReadLastMessage,
    async (_event, payload: ReadAgentLastMessageInput): Promise<ReadAgentLastMessageResult> => {
      const normalized = normalizeReadLastMessagePayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'agent:read-last-message cwd is outside approved workspaces',
        })
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

      if (normalized.provider === 'opencode') {
        const message = await readLastAssistantMessageFromOpenCodeSession(
          resumeSessionId,
          normalized.cwd,
        )

        return { message }
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
    { defaultErrorCode: 'agent.read_last_message_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentLaunch,
    async (_event, payload: LaunchAgentInput) => {
      const normalized = normalizeLaunchAgentPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'agent:launch cwd is outside approved workspaces',
        })
      }

      const opencodeServer =
        normalized.provider === 'opencode'
          ? {
              hostname: OPENCODE_SERVER_HOSTNAME,
              port: await reserveLoopbackPort(OPENCODE_SERVER_HOSTNAME),
            }
          : null

      const launchCommand = buildAgentLaunchCommand({
        provider: normalized.provider,
        mode: normalized.mode ?? 'new',
        prompt: normalized.prompt,
        model: normalized.model ?? null,
        resumeSessionId: normalized.resumeSessionId ?? null,
        agentFullAccess: normalized.agentFullAccess ?? true,
        opencodeServer,
      })

      const testStub = resolveAgentTestStub(
        normalized.provider,
        normalized.cwd,
        launchCommand.effectiveModel,
        normalized.mode,
      )

      const geminiDiscoveryCursor =
        normalized.provider === 'gemini' &&
        launchCommand.launchMode === 'new' &&
        !launchCommand.resumeSessionId
          ? await captureGeminiSessionDiscoveryCursor(normalized.cwd).catch(() => null)
          : undefined

      const launchStartedAtMs = Date.now()
      const resolvedInvocation = await resolveAgentCliInvocation({
        command: testStub?.command ?? launchCommand.command,
        args: testStub?.args ?? launchCommand.args,
      })

      const opencodeTuiConfigPath =
        normalized.provider === 'opencode'
          ? (normalizeOptionalEnvValue(process.env.OPENCODE_TUI_CONFIG) ??
            (await ensureOpenCodeEmbeddedTuiConfigPath()))
          : null

      const sessionEnv =
        opencodeServer && normalized.provider === 'opencode'
          ? {
              ...process.env,
              OPENCOVE_OPENCODE_SERVER_HOSTNAME: opencodeServer.hostname,
              OPENCOVE_OPENCODE_SERVER_PORT: String(opencodeServer.port),
              ...(opencodeTuiConfigPath ? { OPENCODE_TUI_CONFIG: opencodeTuiConfigPath } : {}),
            }
          : undefined

      const { sessionId } = ptyRuntime.spawnSession({
        cwd: normalized.cwd,
        cols: normalized.cols ?? 80,
        rows: normalized.rows ?? 24,
        command: resolvedInvocation.command,
        args: resolvedInvocation.args,
        ...(sessionEnv ? { env: sessionEnv } : {}),
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
          launchMode: launchCommand.launchMode,
          resumeSessionId,
          startedAtMs: launchStartedAtMs,
          ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
          opencodeBaseUrl: opencodeServer
            ? `http://${opencodeServer.hostname}:${opencodeServer.port}`
            : null,
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
    },
    { defaultErrorCode: 'agent.launch_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.agentListModels)
      ipcMain.removeHandler(IPC_CHANNELS.agentListInstalledProviders)
      ipcMain.removeHandler(IPC_CHANNELS.agentResolveResumeSession)
      ipcMain.removeHandler(IPC_CHANNELS.agentReadLastMessage)
      ipcMain.removeHandler(IPC_CHANNELS.agentLaunch)
      disposeAgentModelService()
    },
  }
}
