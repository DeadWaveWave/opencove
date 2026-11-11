import { editSpaceOrder, assertCanonicalSpaceOrder } from './spaceOrdering'
import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { useCanvasCollapseStore } from '@contexts/workspace/presentation/renderer/store/useCanvasCollapseStore'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import * as publication from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import {
  writePersistedState,
  writeRawPersistedState,
  markPersistedStateAsSynced,
} from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
import { requestCanonicalRefresh } from '@contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import { acceptPersistedStateSnapshot } from '@contexts/workspace/presentation/renderer/utils/persistence/accept'
import { readPersistedStateWithMeta } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
import { capturePublication } from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import { projectManagedClaudeRuntimeData } from '@contexts/workspace/presentation/renderer/utils/managedClaudeProjection'
import { RevisionedSnapshotCache } from '@shared/sync/revisionedSnapshotCache'
import { STORAGE_KEY } from '@contexts/workspace/presentation/renderer/utils/persistence/constants'
import { toggleSidebarCollapsedId } from '@contexts/settings/domain/sidebarTreeSettings'
import { autosave, quit } from './lifecycle'
import { fixture, value, snapshot } from './fixture'
import { LocalViewModel, withLocalViews } from './localViews'
import { persistLocalViewStateFromAppState } from '@contexts/workspace/presentation/renderer/utils/persistence/viewState'
import { stripPersistedAppViewState } from '@shared/sync/canonicalizePersistedAppState'
import { Server, type Adapter } from './server'
import type { Action, Response } from './model'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
export class Client {
  server: Server
  localViews: LocalViewModel
  caches = new Set<RevisionedSnapshotCache<PersistedAppState>>()
  private queuedFlush: Promise<boolean> | null = null
  private inFlight: Promise<unknown> | null = null
  private legacyHistory = false
  private captured: ReturnType<typeof capturePublication> | null = null
  private autosaveHook: ReturnType<typeof renderHook> | null = null
  private stopped = false
  private hook: ReturnType<typeof renderHook>
  private event: ((event: { type: 'resync_required'; revision: number }) => void) | undefined
  private original = {
    api: window.opencoveApi,
    app: useAppStore.getState(),
    collapse: useCanvasCollapseStore.getState().workspaces,
  }
  private cacheSpy: ReturnType<typeof vi.spyOn>
  constructor(
    readonly owned: boolean,
    readonly adapter: Adapter,
    response: Response,
  ) {
    vi.useFakeTimers()
    const initial = withLocalViews(fixture(owned))
    this.localViews = new LocalViewModel(initial)
    this.server = new Server(stripPersistedAppViewState(initial), response)
    const caches = this.caches,
      set = RevisionedSnapshotCache.prototype.set
    this.cacheSpy = vi.spyOn(RevisionedSnapshotCache.prototype, 'set').mockImplementation(function (
      this: RevisionedSnapshotCache<PersistedAppState>,
      r,
      s,
    ) {
      caches.add(this)
      set.call(this, r, s)
    })
    this.installApi()
    useCanvasCollapseStore.setState({ workspaces: {} })
    persistLocalViewStateFromAppState(initial)
    this.apply(initial)
    acceptPersistedStateSnapshot({
      state: snapshot(this.server.template, this.server.model.value),
      revision: 1,
      isPersisted: true,
    })
    this.hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
  }
  private installApi() {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        meta: { isTest: true },
        persistence: this.server.api(this.adapter),
        sync: {
          onStateUpdated: (listener: typeof this.event) => {
            this.event = listener
            return () => {
              this.event = undefined
            }
          },
        },
      },
    })
  }
  async restart() {
    if (!this.stopped) {
      await this.shutdown()
    }
    this.caches.clear()
    this.installApi()
    publication.persistenceScope()
    const read = await readPersistedStateWithMeta()
    if (!read.state) {
      throw new Error('Cold restart has no durable state')
    }
    this.apply(read.state)
    acceptPersistedStateSnapshot(read)
    this.hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
    this.stopped = false
    this.check(true)
  }
  async shutdown() {
    this.hook.unmount()
    this.autosaveHook?.unmount()
    this.autosaveHook = null
    // Change the persistence owner before discarding the scheduler; a stale producer cannot run.
    Object.defineProperty(window, 'opencoveApi', { configurable: true, value: undefined })
    publication.persistenceScope()
    await flushScheduledPersistedStateWriteAsync()
    useAppStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      agentSettings: fixture(this.owned).settings,
      persistNotice: null,
    })
    useCanvasCollapseStore.setState({ workspaces: {} })
    this.stopped = true
  }
  state = () => {
    const s = useAppStore.getState()
    return toPersistedState(s.workspaces, s.activeWorkspaceId, s.agentSettings)
  }
  apply(state: PersistedAppState) {
    useAppStore.setState({
      workspaces: state.workspaces.map(workspace => toShellWorkspaceState(workspace)),
      activeWorkspaceId: state.activeWorkspaceId,
      agentSettings: state.settings,
    })
  }
  write = () =>
    this.adapter.startsWith('raw')
      ? writeRawPersistedState(JSON.stringify(this.state()))
      : writePersistedState(this.state())
  async settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
  }
  async step(action: Action) {
    if (this.stopped) {
      await this.restart()
    }
    if (!this.autosaveHook && ['view', 'sidebar-collapse', 'sidebar-expand'].includes(action)) {
      // Commit the initial hydration skip before producing user input, as the app does.
      await act(async () => {
        this.autosaveHook = autosave(this)
      })
    }
    await act(async () => {
      if (action === 'rename' || action === 'title') {
        const field = action === 'rename' ? 'name' : 'title',
          next = `user-${this.server.model.intents.length}`
        this.server.model.edit(field, next)
        useAppStore.getState().setWorkspaces(ws =>
          ws.map(w =>
            action === 'rename'
              ? { ...w, name: next }
              : {
                  ...w,
                  nodes: w.nodes.map(n =>
                    n.id === 'agent'
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            title: next,
                            titlePinnedByUser: true,
                            titleIsLiteral: true,
                          },
                        }
                      : n,
                  ),
                },
          ),
        )
      } else if (action === 'collapse') {
        this.server.model.edit('collapsed', true)
        useCanvasCollapseStore.getState().update('project', s => ({
          ...s,
          collapsedNodeIds: { ...s.collapsedNodeIds, agent: true },
        }))
      } else if (action === 'sidebar-collapse' || action === 'sidebar-expand') {
        const collapsed = action === 'sidebar-collapse'
        this.server.model.edit('sidebar', collapsed)
        this.server.model.edit('sidebarRoot', collapsed)
        const groups = toggleSidebarCollapsedId(
          toggleSidebarCollapsedId(
            useAppStore.getState().agentSettings.sidebarCollapsedSpaceGroupIds,
            'project:space',
          ),
          'project:project-root',
        )
        useAppStore.getState().setAgentSettings(previous => ({
          ...previous,
          sidebarCollapsedSpaceGroupIds: groups,
        }))
      } else if (action === 'autosave') {
        await this.settle()
      } else if (action === 'cold-restart') {
        await this.restart()
      } else if (action === 'raw-import') {
        const imported = this.state()
        imported.workspaces[0].name = 'Imported project'
        this.server.model.edit('name', 'Imported project')
        await writeRawPersistedState(JSON.stringify(imported))
      } else if (action === 'view') {
        const intent = this.localViews.edit()
        useAppStore.setState(s => ({
          activeWorkspaceId: intent.activeWorkspaceId,
          workspaces: s.workspaces.map(w => ({ ...w, ...intent.workspaces[w.id] })),
        }))
      } else if (action === 'schedule') {
        schedulePersistedStateWrite(this.state, { delayMs: 10000 })
      } else if (action === 'flush') {
        await this.write()
      } else if (action === 'begin-write') {
        this.server.delayResponse = true
        this.inFlight = this.write()
      } else if (action === 'begin-import') {
        const imported = this.state()
        imported.workspaces[0].name = 'Imported project'
        this.server.model.edit('name', 'Imported project')
        this.server.delayResponse = true
        this.inFlight = writeRawPersistedState(JSON.stringify(imported))
      } else if (action === 'flush-queued') {
        this.queuedFlush = flushScheduledPersistedStateWriteAsync()
        await Promise.resolve()
        await Promise.resolve()
        if (this.server.writes !== 1) {
          throw new Error('I10: autosave submitted before replacement receipt')
        }
      } else if (action === 'space-reorder' || action === 'space-pin') {
        editSpaceOrder(this, action === 'space-pin')
      } else if (action === 'reply') {
        this.server.reply()
        await this.inFlight
        await this.queuedFlush
        this.queuedFlush = null
        this.inFlight = null
      } else if (action === 'lose-next') {
        this.server.response = 'lost-committed'
      } else if (action === 'capture') {
        this.captured = capturePublication(this.state())
      } else if (action === 'new-acceptance') {
        this.server.model.thirdParty()
        markPersistedStateAsSynced(
          snapshot(this.server.template, this.server.model.value),
          this.server.model.revision,
        )
      } else if (action === 'stale-read') {
        this.server.stale = {
          state: snapshot(this.server.template, this.server.model.history.get(1)!),
          revision: 1,
        }
      } else if (action === 'restore-read') {
        this.server.stale = null
      } else if (action === 'rebind' || action === 'settle' || action === 'associate') {
        if (this.owned) {
          if (action === 'rebind') {
            this.server.model.value.tuple = 'B'
          }
          if (action === 'settle') {
            const node = this.server.template.workspaces[0].nodes[0]
            node.managedClaudeResumeBindingOwnership = {
              ...node.managedClaudeResumeBindingOwnership!,
              runtimeSessionId: null,
            }
            this.server.model.value.runtime = ''
            this.server.model.verified = false
            this.server.model.verifiedRevision = this.server.model.revision + 1
            node.agent!.resumeSessionIdVerified = false
          }
          if (action === 'associate') {
            this.server.model.value.runtime = 'shell-T'
          }
          this.server.model.history.set(++this.server.model.revision, {
            ...this.server.model.value,
          })
          this.server.model.verificationHistory.set(
            this.server.model.revision,
            this.server.model.verified,
          )
        }
      } else if (action === 'third-party') {
        this.server.model.thirdParty()
      } else if (action === 'observe') {
        requestCanonicalRefresh({ reason: 'merged', minimumRevision: this.server.model.revision })
      } else if (action === 'event' || action === 'reverse-event') {
        this.event?.({
          type: 'resync_required',
          revision: action === 'event' ? this.server.model.revision : 1,
        })
      } else if (action === 'reconnect') {
        this.hook.unmount()
        this.hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
        requestCanonicalRefresh({ reason: 'connect' })
      } else if (action === 'prepare' || action === 'fallback') {
        const node = useAppStore.getState().workspaces[0].nodes[0]
        const proposed = {
          ...node.data,
          sessionId: action === 'fallback' ? 'shell-S' : 'runtime',
          managedClaudeBindingObservation: {
            nodeId: 'agent',
            activationId: 'activation',
            runtimeSessionId: action === 'fallback' ? null : 'runtime',
            tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
            nodeSeen: true,
            bindingRevision: 1,
            observedRevision: action === 'fallback' ? this.server.model.revision : 1,
          },
        }
        const projected = this.owned ? projectManagedClaudeRuntimeData('agent', proposed) : null
        if (projected && action === 'fallback') {
          projected.runtimeSessionBinding = { phase: 'publishing', sessionId: projected.sessionId }
          schedulePersistedStateWrite(this.state, { delayMs: 10000 })
        }
        if (projected) {
          useAppStore.getState().setWorkspaces(ws =>
            ws.map(w => ({
              ...w,
              nodes: w.nodes.map(n => (n.id === 'agent' ? { ...n, data: projected } : n)),
            })),
          )
        }
      } else if (action === 'migration') {
        const legacy = this.state()
        legacy.workspaces[0].nodes.find(n => n.id === 'terminal')!.scrollback = 'legacy history'
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))
        this.server.nextReadNull = true
        this.server.response = 'merged'
        const migrated = await readPersistedStateWithMeta()
        this.legacyHistory = true
        if (migrated.isPersisted && this.server.scrollbacks.get('terminal') !== 'legacy history') {
          throw new Error('I1: migration dropped terminal history')
        }
      } else if (action === 'quit' || action === 'quit-timeout' || action === 'quit-failure') {
        if (await quit(this, this.captured ?? this.state(), action)) {
          await this.shutdown()
        }
      }
    })
    if (
      action === 'refresh' ||
      action === 'event' ||
      action === 'reverse-event' ||
      action === 'reconnect'
    ) {
      await this.settle()
    }
    if (this.stopped) {
      return
    }
    try {
      this.check(false)
    } catch (error) {
      throw new Error(
        `${action}: ${String(error)}; pending=${JSON.stringify({ kind: publication.getPendingPublication()?.kind, draft: publication.getPendingPublication()?.draftRaw ? value(JSON.parse(publication.getPendingPublication()!.draftRaw!)) : null })}`,
        { cause: error },
      )
    }
  }
  check(quiet: boolean) {
    this.localViews.check(this.state())
    const pending = publication.getPendingPublication()
    const draft = publication.isPublicationBlocked(pending)
      ? (JSON.parse(
          ((pending && 'draftRaw' in pending ? pending!.draftRaw : null) as string) ??
            pending!.candidateRaw,
        ) as PersistedAppState)
      : null
    const accepted = publication.getSyncedPersistedState()
    assertCanonicalSpaceOrder([...this.caches].at(-1)?.latest?.state)
    this.server.model.check(
      {
        ui: value(this.state()),
        draft: draft ? value(draft) : null,
        accepted: accepted ? value(accepted) : null,
        revision: publication.getAcceptedRevision(),
        cache: [...this.caches].at(-1)?.latest?.state
          ? value([...this.caches].at(-1)!.latest!.state!)
          : null,
        viewConsistent:
          !accepted ||
          publication.canAcceptCanonicalState(accepted, publication.getAcceptedRevision()) ===
            publication.canAcceptCanonicalState(
              {
                ...accepted,
                workspaces: accepted.workspaces.map(w => ({
                  ...w,
                  viewport: { x: 999, y: 2, zoom: 3 },
                })),
              },
              publication.getAcceptedRevision(),
            ),
        surfaced: !!useAppStore.getState().persistNotice,
        acceptedVerified: accepted?.workspaces[0].nodes[0].agent?.resumeSessionIdVerified === true,
        verified:
          useAppStore.getState().workspaces[0].nodes[0].data.agent?.resumeSessionIdVerified ===
          true,
      },
      quiet,
      this.owned,
    )
  }
  async quiet() {
    if (this.stopped) {
      await this.restart()
      this.check(true)
      await this.localViews.checkColdRestore()
      return
    }
    await this.step('observe')
    await this.settle()
    // Even an unconfirmed shared publication must drain local-view persistence.
    // The production publication barrier still forbids another shared submission.
    await flushScheduledPersistedStateWriteAsync()
    await this.step('observe')
    await this.settle()
    this.check(true)
    await this.localViews.checkColdRestore()
    if (this.legacyHistory && this.server.scrollbacks.get('terminal') !== 'legacy history') {
      throw new Error('I1: terminal history was neither migrated nor retained')
    }
  }
  async close() {
    this.server.reply()
    await this.inFlight
    await this.queuedFlush
    if (!this.stopped) {
      await this.shutdown()
    }
    this.cacheSpy.mockRestore()
    useAppStore.setState(this.original.app, true)
    useCanvasCollapseStore.setState({ workspaces: this.original.collapse })
    Object.defineProperty(window, 'opencoveApi', { configurable: true, value: this.original.api })
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
}
