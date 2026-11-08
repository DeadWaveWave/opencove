import type {
  AgentTurnArchive,
  AgentTurnArchiveReadResult,
} from '../../../contexts/agent/application/AgentTurnArchive'
import { createAgentTurnArchive } from '../../../contexts/agent/application/createAgentTurnArchive'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'

/** Worker-owned membership projection; no registry, history, handler or CLI integration. */
export function createWorkerAgentTurnArchiveRuntime(options: {
  enabled: boolean
  userDataPath: string
  getPersistenceStore: () => Promise<PersistenceStore>
  open?: (options: {
    userDataPath: string
    membership: (nodeId?: string) => 'member' | 'absent' | 'unknown'
  }) => AgentTurnArchive | Promise<AgentTurnArchive>
}) {
  let members: ReadonlySet<string> | null = null
  let membershipGeneration = 0
  const membership = (id?: string) =>
    members === null
      ? ('unknown' as const)
      : id === undefined || members.has(id)
        ? ('member' as const)
        : ('absent' as const)
  const project = (raw: unknown) => {
    const state = normalizePersistedAppState(raw)
    members =
      raw === null || state
        ? new Set(state?.workspaces.flatMap(w => w.nodes.map(n => n.id)) ?? [])
        : null
  }
  const wrappers = new WeakMap<PersistenceStore, PersistenceStore>()
  const getPersistenceStore = async () => {
    const store = await options.getPersistenceStore()
    if (!options.enabled) {
      return store
    }
    let wrapper = wrappers.get(store)
    if (!wrapper) {
      const committed = (raw: unknown) => {
        membershipGeneration++
        project(raw)
      }
      wrapper = {
        ...store,
        writeAppState: async (state, opts) => {
          const result = await store.writeAppState(state, opts)
          if (result.ok) {
            committed(state)
          }
          return result
        },
        writeWorkspaceStateRaw: async raw => {
          const result = await store.writeWorkspaceStateRaw(raw)
          if (result.ok) {
            try {
              committed(JSON.parse(raw))
            } catch {
              membershipGeneration++
              members = null
            }
          }
          return result
        },
      }
      wrappers.set(store, wrapper)
    }
    return wrapper
  }
  let archive = createAgentTurnArchive(null)
  let stopped = false
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let startPromise: Promise<void> | undefined
  let sweeping: Promise<void> | undefined
  let maintenanceRequested = false
  const refreshMembership = async () => {
    const generation = membershipGeneration
    const store = await getPersistenceStore()
    if (stopped) {
      return
    }
    const raw = await store.readAppState()
    // A concurrent successful commit owns the newer projection; an older read cannot replace it.
    if (!stopped && generation === membershipGeneration) {
      project(raw)
    }
  }
  const maintenance = (): Promise<void> => {
    maintenanceRequested = true
    if (sweeping) {
      return sweeping
    }
    maintenanceRequested = false
    sweeping = (async () => {
      try {
        const throughSeq = archive.captureWatermark() // Before every asynchronous membership read.
        await refreshMembership()
        if (throughSeq === null || stopped) {
          return
        }
        let result
        do {
          if (stopped) {
            return
          }
          result = archive.sweep(Date.now(), members ?? undefined, throughSeq)
          if (result.status === 'more') {
            // Each batch depends on the previous cursor; yield instead of parallelizing deletions.
            // oxlint-disable-next-line no-await-in-loop
            await new Promise<void>(resolve => setImmediate(resolve))
          }
        } while (result.status === 'more')
        if (!stopped) {
          archive.checkpoint()
        }
      } catch {
        members = null
        archive.dispose()
        process.stderr.write('[opencove] ended-turn archive sweep unavailable.\n')
      }
    })().finally(() => {
      sweeping = undefined
      if (maintenanceRequested && !stopped) {
        void maintenance()
      }
    })
    return sweeping
  }
  const filter = (result: AgentTurnArchiveReadResult): AgentTurnArchiveReadResult => {
    if (members === null) {
      return { status: 'unavailable' }
    }
    return result.status === 'found' && !members.has(result.record.nodeId)
      ? { status: 'absent' }
      : result
  }
  const port: AgentTurnArchive = {
    append: input => {
      const result = archive.append(input)
      if (result.status === 'memory_only' && result.reason === 'retention_backlog' && !stopped) {
        void maintenance()
      }
      return result
    },
    getExact: input =>
      members === null
        ? { status: 'unavailable' }
        : !members.has(input.nodeId)
          ? { status: 'absent' }
          : filter(archive.getExact(input)),
    getExactBySession: input =>
      members === null ? { status: 'unavailable' } : filter(archive.getExactBySession(input)),
    revokeNodes: ids => archive.revokeNodes(ids),
    captureWatermark: () => archive.captureWatermark(),
    sweep: (now, existing, through) => archive.sweep(now, existing, through),
    checkpoint: () => archive.checkpoint(),
    dispose: () => archive.dispose(),
  }
  const stop = () => {
    stopped = true
    clearInterval(timer)
  }
  return {
    port,
    getPersistenceStore,
    start: () =>
      (startPromise ??= (async () => {
        if (!options.enabled || stopped) {
          return
        }
        try {
          await refreshMembership()
          if (stopped) {
            return
          }
          const open =
            options.open ??
            (
              await import('../../../contexts/agent/infrastructure/turnArchive/createSqliteAgentTurnArchive')
            ).createSqliteAgentTurnArchive
          if (stopped) {
            return
          }
          const candidate = await open({ userDataPath: options.userDataPath, membership })
          if (stopped) {
            candidate.dispose()
            return
          }
          archive = candidate
          await maintenance() // Reconcile all startup batches, yielding between each one.
          if (stopped) {
            return
          }
          timer = setInterval(
            () => {
              void maintenance()
            },
            3 * 60 * 60 * 1000,
          )
          timer.unref()
        } catch {
          members = null
          archive.dispose()
          process.stderr.write('[opencove] ended-turn archive startup unavailable.\n')
        }
      })()),
    stop,
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      stop()
      archive.checkpoint()
      archive.dispose()
    },
  }
}
