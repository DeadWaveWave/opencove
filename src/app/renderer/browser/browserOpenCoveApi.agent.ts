import type {
  ListInstalledAgentProvidersResult,
  ReadAgentLastMessageResult,
} from '@shared/contracts/dto'
import { AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { invokeBrowserControlSurface } from './browserControlSurface'
import { resolveBrowserPlatform, resolveSpaceIdForCwd } from './browserOpenCoveApi.helpers'

type AgentApi = Window['opencoveApi']['agent']

export function createBrowserAgentApi(): AgentApi {
  return {
    listModels: async payload => ({
      provider: payload.provider,
      source:
        payload.provider === 'claude-code'
          ? 'claude-static'
          : payload.provider === 'codex'
            ? 'codex-cli'
            : payload.provider === 'opencode'
              ? 'opencode-cli'
              : 'gemini-cli',
      fetchedAt: new Date().toISOString(),
      models: [],
      error: null,
    }),
    listInstalledProviders: async (): Promise<ListInstalledAgentProvidersResult> => ({
      providers: [...AGENT_PROVIDERS],
    }),
    launch: async payload => {
      const platform = resolveBrowserPlatform()
      const cwd = payload.cwd.trim()

      const runtimeAppState = {
        workspaces: useAppStore.getState().workspaces,
      }
      let spaceId = resolveSpaceIdForCwd({ appState: runtimeAppState, cwd, platform })

      if (!spaceId) {
        const persisted = await invokeBrowserControlSurface<{
          revision: number
          state: unknown | null
        }>({
          kind: 'query',
          id: 'sync.state',
          payload: null,
        })

        spaceId = resolveSpaceIdForCwd({ appState: persisted.state, cwd, platform })
      }

      if (!spaceId) {
        throw new Error(`No matching space found for cwd: ${cwd}`)
      }

      const launched = await invokeBrowserControlSurface<{
        sessionId: string
        provider: string
        startedAt: string
        executionContext: unknown
        resumeSessionId: string | null
        effectiveModel: string | null
        command: string
        args: string[]
      }>({
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          spaceId,
          prompt: payload.prompt,
          provider: payload.provider,
          model: payload.model ?? null,
          agentFullAccess: payload.agentFullAccess ?? true,
        },
      })

      return {
        sessionId: launched.sessionId,
        provider: payload.provider,
        profileId: payload.profileId ?? null,
        runtimeKind: 'posix',
        command: launched.command,
        args: launched.args,
        launchMode: payload.mode ?? 'new',
        effectiveModel: launched.effectiveModel,
        resumeSessionId: launched.resumeSessionId,
      }
    },
    readLastMessage: async (): Promise<ReadAgentLastMessageResult> => ({
      message: null,
    }),
    resolveResumeSessionId: async () => ({
      resumeSessionId: null,
    }),
  }
}
