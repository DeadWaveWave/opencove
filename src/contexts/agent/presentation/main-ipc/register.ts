import { ipcMain } from 'electron'
import { createServer } from 'node:net'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  LaunchAgentInput,
  LaunchAgentResult,
  ListAgentModelsInput,
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
import type { PtyRuntime } from '../../../terminal/presentation/main-ipc/runtime'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import {
  normalizeLaunchAgentPayload,
  normalizeListModelsPayload,
  normalizeResolveResumeSessionPayload,
  resolveAgentTestStub,
} from './validate'

const HYDRATE_RESUME_RESOLVE_TIMEOUT_MS = 3_000
const OPENCODE_SERVER_HOSTNAME = '127.0.0.1'

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

  ipcMain.handle(IPC_CHANNELS.agentLaunch, async (_event, payload: LaunchAgentInput) => {
    const normalized = normalizeLaunchAgentPayload(payload)

    const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
    if (!isApproved) {
      throw new Error('agent:launch cwd is outside approved workspaces')
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
        launchMode: launchCommand.launchMode,
        resumeSessionId,
        startedAtMs: launchStartedAtMs,
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
  })

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.agentListModels)
      ipcMain.removeHandler(IPC_CHANNELS.agentResolveResumeSession)
      ipcMain.removeHandler(IPC_CHANNELS.agentLaunch)
      disposeAgentModelService()
    },
  }
}
