import { app, shell, webContents } from 'electron'
import { fileURLToPath } from 'node:url'
import type {
  SyncEventPayload,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { createApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { trashItemWithTimeout } from '../../../contexts/filesystem/application/deleteEntryWithTrashFallback'
import { createPtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import { createMainTerminalProcessEngine } from '../terminal/mainTerminalProcessEngineFactory'
import { closeWebsiteWindowNodeAcrossManagers } from '../websiteWindow/websiteWindowManagerRegistry'
import { registerControlSurfaceHttpServer } from './controlSurfaceHttpServer'
import type { ControlSurfaceHttpServerInstance } from './controlSurfaceHttpServer.contract'
import { readRuntimeAppVersion } from './runtimeAppVersion'
import { createClaudeHookChannel } from './agentHook/claudeHookChannel'
import { createCodexHookChannel } from './agentHook/codexHookChannel'
import { AgentProviderRegistry } from '../../../contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'

const CONTROL_SURFACE_TRASH_TIMEOUT_MS = 3_000

export type {
  ControlSurfaceConnectionInfo,
  ControlSurfaceHttpServerInstance,
  ControlSurfaceServerDisposable,
} from './controlSurfaceHttpServer.contract'

export function registerControlSurfaceServer(deps?: {
  approvedWorkspaces?: ReturnType<typeof createApprovedWorkspaceStore>
  ptyRuntime?: ReturnType<typeof createPtyRuntime>
}): ControlSurfaceHttpServerInstance {
  const userDataPath = app.getPath('userData')
  const approvedWorkspaces = deps?.approvedWorkspaces ?? createApprovedWorkspaceStore()
  const ownsPtyRuntime = !deps?.ptyRuntime
  const ptyRuntime =
    deps?.ptyRuntime ?? createPtyRuntime({ processEngine: createMainTerminalProcessEngine() })
  const claudeHookChannel = createClaudeHookChannel({})
  const codexHookChannel = createCodexHookChannel({})
  const agentHookChannels = {
    'claude-code': claudeHookChannel,
    codex: codexHookChannel,
  }
  const agentProviderRegistry = new AgentProviderRegistry(
    createBuiltinAgentProviderContributions({
      channels: agentHookChannels,
      runtimeExecutable: process.execPath,
      runtimePlatform: process.platform,
    }),
  )

  return registerControlSurfaceHttpServer({
    userDataPath,
    appVersion: readRuntimeAppVersion(),
    approvedWorkspaces,
    ptyRuntime,
    ownsPtyRuntime,
    deleteEntry: async uri =>
      await trashItemWithTimeout(
        async targetPath => await shell.trashItem(targetPath),
        fileURLToPath(uri),
        CONTROL_SURFACE_TRASH_TIMEOUT_MS,
      ),
    desktopSyncEventSink: sendSyncEventToDesktopWindows,
    desktopPtyStateSink: sendPtyStateToDesktopWindows,
    desktopPtyMetadataSink: sendPtyMetadataToDesktopWindows,
    closeWebsiteNode: async nodeId => await closeWebsiteWindowNodeAcrossManagers(nodeId),
    agentHookChannels: [claudeHookChannel, codexHookChannel],
    agentProviderRegistry,
  })
}

function sendPtyStateToDesktopWindows(payload: TerminalSessionStateEvent): number {
  return sendPtyEventToDesktopWindows(IPC_CHANNELS.ptyState, payload)
}

function sendPtyMetadataToDesktopWindows(payload: TerminalSessionMetadataEvent): number {
  return sendPtyEventToDesktopWindows(IPC_CHANNELS.ptySessionMetadata, payload)
}

function sendPtyEventToDesktopWindows(channel: string, payload: unknown): number {
  let delivered = 0
  for (const content of webContents.getAllWebContents()) {
    if (content.isDestroyed() || content.getType() !== 'window') {
      continue
    }
    try {
      content.send(channel, payload)
      delivered += 1
    } catch {
      // Ignore destroyed or navigating windows.
    }
  }
  return delivered
}

function sendSyncEventToDesktopWindows(payload: SyncEventPayload): number {
  let delivered = 0
  for (const content of webContents.getAllWebContents()) {
    if (content.isDestroyed() || content.getType() !== 'window') {
      continue
    }
    try {
      content.send(IPC_CHANNELS.syncStateUpdated, payload)
      delivered += 1
    } catch {
      // ignore
    }
  }
  return delivered
}
