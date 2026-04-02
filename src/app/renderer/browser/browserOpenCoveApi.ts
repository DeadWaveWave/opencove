import type { ListSystemFontsResult } from '@shared/contracts/dto'
import { BrowserPtyClient } from './BrowserPtyClient'
import { invokeBrowserControlSurface } from './browserControlSurface'
import {
  createUnsupportedUpdateState,
  resolveBrowserPlatform,
  unsupportedCliStatus,
  unsupportedPathOpeners,
  unsupportedReleaseNotes,
  unsupportedWorkerConfig,
  unsupportedWorkerStatus,
} from './browserOpenCoveApi.helpers'
import { createBrowserPersistenceApi } from './browserOpenCoveApi.persistence'
import { createBrowserAgentApi } from './browserOpenCoveApi.agent'

const ptyClient = new BrowserPtyClient()
const unsupportedUpdateState = createUnsupportedUpdateState()

export function installBrowserOpenCoveApi(): void {
  const api = {
    meta: {
      isTest: false,
      allowWhatsNewInTests: false,
      enableTerminalDiagnostics: false,
      platform: resolveBrowserPlatform(),
      windowsPty: null,
    },
    debug: {
      logTerminalDiagnostics: () => undefined,
    },
    windowChrome: {
      setTheme: async () => undefined,
    },
    windowMetrics: {
      getDisplayInfo: async () => ({
        contentWidthDip: window.innerWidth,
        contentHeightDip: window.innerHeight,
        displayScaleFactor: window.devicePixelRatio || 1,
        effectiveWidthPx: Math.round(window.innerWidth * (window.devicePixelRatio || 1)),
        effectiveHeightPx: Math.round(window.innerHeight * (window.devicePixelRatio || 1)),
      }),
    },
    clipboard: {
      readText: async () => {
        if (navigator.clipboard?.readText) {
          return await navigator.clipboard.readText()
        }
        return ''
      },
      writeText: async text => {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
        }
      },
    },
    filesystem: {
      createDirectory: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'filesystem.createDirectory',
          payload,
        })
      },
      copyEntry: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'filesystem.copyEntry',
          payload,
        })
      },
      moveEntry: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'filesystem.moveEntry',
          payload,
        })
      },
      renameEntry: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'filesystem.renameEntry',
          payload,
        })
      },
      deleteEntry: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'filesystem.deleteEntry',
          payload,
        })
      },
      readFileBytes: async () => {
        throw new Error('Binary file reads are unavailable in browser runtime')
      },
      readFileText: async payload =>
        await invokeBrowserControlSurface({
          kind: 'query',
          id: 'filesystem.readFileText',
          payload,
        }),
      writeFileText: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'filesystem.writeFileText',
          payload,
        })
      },
      readDirectory: async payload =>
        await invokeBrowserControlSurface({
          kind: 'query',
          id: 'filesystem.readDirectory',
          payload,
        }),
      stat: async payload =>
        await invokeBrowserControlSurface({
          kind: 'query',
          id: 'filesystem.stat',
          payload,
        }),
    },
    persistence: {
      ...createBrowserPersistenceApi(),
    },
    sync: {
      onStateUpdated: listener => {
        const token = new URLSearchParams(window.location.search).get('token')
        const url = new URL('/events', window.location.origin)
        if (token) {
          url.searchParams.set('token', token)
        }
        const source = new EventSource(url.toString(), { withCredentials: true })

        const handler = (event: MessageEvent<string>) => {
          try {
            listener(JSON.parse(event.data) as Parameters<typeof listener>[0])
          } catch {
            // ignore invalid payloads
          }
        }

        source.addEventListener('opencove.sync', handler as EventListener)
        return () => {
          source.removeEventListener('opencove.sync', handler as EventListener)
          source.close()
        }
      },
    },
    workspace: {
      selectDirectory: async () => null,
      ensureDirectory: async payload => {
        await invokeBrowserControlSurface<void>({
          kind: 'command',
          id: 'workspace.ensureDirectory',
          payload,
        })
      },
      copyPath: async payload => {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(payload.path)
        }
      },
      listPathOpeners: async () => unsupportedPathOpeners(),
      openPath: async () => undefined,
      writeCanvasImage: async () => {
        throw new Error('Canvas image uploads are unavailable in browser runtime')
      },
      readCanvasImage: async () => null,
      deleteCanvasImage: async () => undefined,
    },
    worktree: {
      listBranches: async () => ({ branches: [] }),
      listWorktrees: async () => ({ worktrees: [] }),
      statusSummary: async () => ({ changedFileCount: 0 }),
      getDefaultBranch: async () => ({ branch: null }),
      create: async () => {
        throw new Error('Worktree creation is unavailable in browser runtime')
      },
      remove: async () => {
        throw new Error('Worktree removal is unavailable in browser runtime')
      },
      renameBranch: async () => {
        throw new Error('Branch rename is unavailable in browser runtime')
      },
      suggestNames: async payload => ({
        branchName: payload.spaceName,
        worktreeName: payload.spaceName,
        provider: payload.provider,
        effectiveModel: payload.model ?? null,
      }),
    },
    integration: {
      github: {
        resolvePullRequests: async () => ({ pullRequestsByBranch: {} }),
      },
    },
    update: {
      getState: async () => unsupportedUpdateState,
      configure: async () => unsupportedUpdateState,
      checkForUpdates: async () => unsupportedUpdateState,
      downloadUpdate: async () => unsupportedUpdateState,
      installUpdate: async () => undefined,
      onState: () => () => undefined,
    },
    releaseNotes: {
      getCurrent: async () => unsupportedReleaseNotes(),
    },
    pty: {
      listProfiles: () => ptyClient.listProfiles(),
      spawn: payload => ptyClient.spawn(payload),
      write: payload => ptyClient.write(payload),
      resize: payload => ptyClient.resize(payload),
      kill: payload => ptyClient.kill(payload),
      attach: payload => ptyClient.attach(payload),
      detach: payload => ptyClient.detach(payload),
      snapshot: payload => ptyClient.snapshot(payload),
      debugCrashHost: () => ptyClient.debugCrashHost(),
      onData: listener => ptyClient.onData(listener),
      onExit: listener => ptyClient.onExit(listener),
      onState: listener => ptyClient.onState(listener),
      onMetadata: listener => ptyClient.onMetadata(listener),
    },
    agent: {
      ...createBrowserAgentApi(),
    },
    task: {
      suggestTitle: async payload => ({
        title: payload.requirement.split('\n')[0]?.trim() || 'Task',
        priority: 'medium',
        tags: [],
        provider: payload.provider,
        effectiveModel: payload.model ?? null,
      }),
    },
    system: {
      listFonts: async (): Promise<ListSystemFontsResult> => ({ fonts: [] }),
    },
    worker: {
      getStatus: async () => unsupportedWorkerStatus(),
      start: async () => unsupportedWorkerStatus(),
      stop: async () => unsupportedWorkerStatus(),
      getWebUiUrl: async () => window.location.href,
    },
    workerClient: {
      getConfig: async () => unsupportedWorkerConfig(),
      setConfig: async () => unsupportedWorkerConfig(),
      relaunch: async () => undefined,
    },
    cli: {
      getStatus: async () => unsupportedCliStatus(),
      install: async () => unsupportedCliStatus(),
      uninstall: async () => unsupportedCliStatus(),
    },
  } as Window['opencoveApi']

  window.opencoveApi = api
}
