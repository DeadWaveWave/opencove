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
import {
  drainPersistedStateAtQuit,
  capturePublication,
} from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import { projectManagedClaudeRuntimeData } from '@contexts/workspace/presentation/renderer/utils/managedClaudeProjection'
import { RevisionedSnapshotCache } from '@shared/sync/revisionedSnapshotCache'
import { STORAGE_KEY } from '@contexts/workspace/presentation/renderer/utils/persistence/constants'
import { fixture, value, snapshot } from './fixture'
import { Server, type Adapter } from './server'
import type { Action, Response } from './model'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
export class Client {
  server: Server
  caches = new Set<RevisionedSnapshotCache<PersistedAppState>>()
  private inFlight: Promise<unknown> | null = null
  private legacyHistory = false
  private captured: ReturnType<typeof capturePublication> | null = null
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
    this.server = new Server(fixture(owned), response)
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
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        persistence: this.server.api(adapter),
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
    useCanvasCollapseStore.setState({ workspaces: {} })
    this.apply(snapshot(this.server.template, this.server.model.value))
    acceptPersistedStateSnapshot({
      state: snapshot(this.server.template, this.server.model.value),
      revision: 1,
      isPersisted: true,
    })
    this.hook = renderHook(() => useWorkerSyncStateUpdates({ enabled: true }))
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
      } else if (action === 'view') {
        useAppStore
          .getState()
          .setWorkspaces(ws =>
            ws.map(w => ({ ...w, viewport: { x: 123, y: 456, zoom: 2 }, isMinimapVisible: false })),
          )
      } else if (action === 'schedule') {
        schedulePersistedStateWrite(this.state, { delayMs: 10000 })
      } else if (action === 'flush') {
        await this.write()
      } else if (action === 'begin-write') {
        this.server.delayResponse = true
        this.inFlight = this.write()
      } else if (action === 'reply') {
        this.server.reply()
        await this.inFlight
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
      } else if (action === 'quit') {
        await drainPersistedStateAtQuit(this.captured ?? this.state(), 50)
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
    const pending = publication.getPendingPublication()
    const draft = publication.isPublicationBlocked(pending)
      ? (JSON.parse(
          ((pending && 'draftRaw' in pending ? pending!.draftRaw : null) as string) ??
            pending!.candidateRaw,
        ) as PersistedAppState)
      : null
    const accepted = publication.getSyncedPersistedState()
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
    await this.step('observe')
    await this.settle()
    if (!publication.isPublicationBlocked()) {
      await flushScheduledPersistedStateWriteAsync()
      await this.step('observe')
      await this.settle()
    }
    this.check(true)
    if (this.legacyHistory && this.server.scrollbacks.get('terminal') !== 'legacy history') {
      throw new Error('I1: terminal history was neither migrated nor retained')
    }
  }
  async close() {
    this.server.reply()
    await this.inFlight
    this.hook.unmount()
    await flushScheduledPersistedStateWriteAsync()
    this.cacheSpy.mockRestore()
    useAppStore.setState(this.original.app, true)
    useCanvasCollapseStore.setState({ workspaces: this.original.collapse })
    Object.defineProperty(window, 'opencoveApi', { configurable: true, value: this.original.api })
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
}
