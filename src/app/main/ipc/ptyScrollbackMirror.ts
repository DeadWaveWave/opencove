import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'

export type PtySessionNodeBinding = {
  sessionId: string
  nodeId: string
}

export type PtyScrollbackMirrorPersistence = Pick<PersistenceStore, 'writeNodeScrollback'>

export type PtyAgentPlaceholderMirrorPersistence = Pick<
  PersistenceStore,
  'writeAgentNodePlaceholderScrollback'
>

export type PtyScrollbackMirrorSnapshotSource = {
  snapshot: (sessionId: string) => Promise<string>
}

export type PtyScrollbackMirror = {
  setBindings: (bindings: PtySessionNodeBinding[]) => void
  flush: () => Promise<void>
  dispose: () => Promise<void>
}

const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const SNAPSHOT_TAIL_CHARS = 128

type SnapshotFingerprint = { length: number; tail: string }

function fingerprintSnapshot(snapshot: string): SnapshotFingerprint {
  if (snapshot.length === 0) {
    return { length: 0, tail: '' }
  }

  return {
    length: snapshot.length,
    tail: snapshot.length <= SNAPSHOT_TAIL_CHARS ? snapshot : snapshot.slice(-SNAPSHOT_TAIL_CHARS),
  }
}

function areFingerprintsEqual(left: SnapshotFingerprint, right: SnapshotFingerprint): boolean {
  return left.length === right.length && left.tail === right.tail
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizePtySessionNodeBindingsPayload(payload: unknown): {
  bindings: PtySessionNodeBinding[]
} {
  if (!payload || typeof payload !== 'object') {
    return { bindings: [] }
  }

  const record = payload as { bindings?: unknown }
  const inputBindings = Array.isArray(record.bindings) ? record.bindings : []
  const bindings: PtySessionNodeBinding[] = []

  for (const item of inputBindings) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as { sessionId?: unknown; nodeId?: unknown }
    const sessionId = normalizeId(candidate.sessionId)
    const nodeId = normalizeId(candidate.nodeId)
    if (!sessionId || !nodeId) {
      continue
    }

    bindings.push({ sessionId, nodeId })
  }

  return { bindings }
}

function buildBindingsMap(bindings: PtySessionNodeBinding[]): Map<string, Set<string>> {
  const nodeIdsBySessionId = new Map<string, Set<string>>()

  for (const binding of bindings) {
    const nodeIds = nodeIdsBySessionId.get(binding.sessionId) ?? new Set<string>()
    nodeIds.add(binding.nodeId)
    nodeIdsBySessionId.set(binding.sessionId, nodeIds)
  }

  return nodeIdsBySessionId
}

function cloneBindingsMap(bindingsMap: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map(
    [...bindingsMap.entries()].map(([sessionId, nodeIds]) => [sessionId, new Set(nodeIds)]),
  )
}

function areBindingsMapsEqual(
  left: Map<string, Set<string>>,
  right: Map<string, Set<string>>,
): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const [sessionId, leftNodeIds] of left.entries()) {
    const rightNodeIds = right.get(sessionId)
    if (!rightNodeIds || leftNodeIds.size !== rightNodeIds.size) {
      return false
    }

    for (const nodeId of leftNodeIds) {
      if (!rightNodeIds.has(nodeId)) {
        return false
      }
    }
  }

  return true
}

function createPtySnapshotMirror<TStore>({
  source,
  getPersistenceStore,
  persistSnapshot,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}: {
  source: PtyScrollbackMirrorSnapshotSource
  getPersistenceStore: () => Promise<TStore>
  persistSnapshot: (store: TStore, nodeId: string, snapshot: string) => Promise<unknown>
  flushIntervalMs?: number
}): PtyScrollbackMirror {
  let disposed = false
  let disposing = false
  let flushTimer: NodeJS.Timeout | null = null
  let operationChain: Promise<void> = Promise.resolve()

  const nodeIdsBySessionId = new Map<string, Set<string>>()
  const lastFingerprintBySessionId = new Map<string, SnapshotFingerprint>()

  const runExclusive = (operation: () => Promise<void>): Promise<void> => {
    const nextOperation = operationChain.then(operation, operation)
    operationChain = nextOperation.catch(() => undefined)
    return nextOperation
  }

  const stopTimer = (): void => {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
  }

  const flushBindings = async (
    bindingsMap: Map<string, Set<string>>,
    fingerprints: Map<string, SnapshotFingerprint>,
  ): Promise<void> => {
    if (bindingsMap.size === 0) {
      return
    }

    try {
      const store = await getPersistenceStore()
      const writes: Promise<unknown>[] = []

      const entries = [...bindingsMap.entries()].filter(([, nodeIds]) => nodeIds.size > 0)

      const snapshots = await Promise.allSettled(
        entries.map(async ([sessionId, nodeIds]) => {
          const snapshot = await source.snapshot(sessionId)
          return { sessionId, nodeIds, snapshot }
        }),
      )

      for (const result of snapshots) {
        if (result.status !== 'fulfilled') {
          continue
        }

        const { sessionId, nodeIds, snapshot } = result.value
        if (snapshot.length === 0) {
          continue
        }

        const fingerprint = fingerprintSnapshot(snapshot)
        const previous = fingerprints.get(sessionId)
        if (previous && areFingerprintsEqual(previous, fingerprint)) {
          continue
        }

        fingerprints.set(sessionId, fingerprint)

        for (const nodeId of nodeIds) {
          writes.push(persistSnapshot(store, nodeId, snapshot))
        }
      }

      if (writes.length > 0) {
        await Promise.allSettled(writes)
      }
    } catch {
      // ignore
    }
  }

  const startTimerIfNeeded = (): void => {
    if (flushTimer || disposed || disposing) {
      return
    }

    flushTimer = setInterval(() => {
      void runExclusive(async () => {
        if (disposed || disposing || nodeIdsBySessionId.size === 0) {
          return
        }

        await flushBindings(nodeIdsBySessionId, lastFingerprintBySessionId)
      })
    }, flushIntervalMs)
  }

  return {
    setBindings: bindings => {
      if (disposed || disposing) {
        return
      }

      const nextBindingsMap = buildBindingsMap(bindings)

      void runExclusive(async () => {
        if (disposed || disposing) {
          return
        }

        if (areBindingsMapsEqual(nodeIdsBySessionId, nextBindingsMap)) {
          return
        }

        if (nodeIdsBySessionId.size > 0) {
          await flushBindings(nodeIdsBySessionId, lastFingerprintBySessionId)
        }

        stopTimer()
        nodeIdsBySessionId.clear()
        lastFingerprintBySessionId.clear()

        for (const [sessionId, nodeIds] of cloneBindingsMap(nextBindingsMap).entries()) {
          nodeIdsBySessionId.set(sessionId, nodeIds)
        }

        if (nodeIdsBySessionId.size === 0) {
          return
        }

        startTimerIfNeeded()
        await flushBindings(nodeIdsBySessionId, lastFingerprintBySessionId)
      })
    },
    flush: async () => {
      if (disposed || disposing) {
        await operationChain
        return
      }

      await runExclusive(async () => {
        if (disposed || disposing || nodeIdsBySessionId.size === 0) {
          return
        }

        await flushBindings(nodeIdsBySessionId, lastFingerprintBySessionId)
      })
    },
    dispose: async () => {
      if (disposed) {
        await operationChain
        return
      }

      if (disposing) {
        await operationChain
        return
      }

      disposing = true
      stopTimer()

      await runExclusive(async () => {
        if (disposed) {
          return
        }

        if (nodeIdsBySessionId.size > 0) {
          await flushBindings(nodeIdsBySessionId, lastFingerprintBySessionId)
        }

        nodeIdsBySessionId.clear()
        lastFingerprintBySessionId.clear()
        disposed = true
      })
    },
  }
}

export function createPtyScrollbackMirror({
  source,
  getPersistenceStore,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}: {
  source: PtyScrollbackMirrorSnapshotSource
  getPersistenceStore: () => Promise<PtyScrollbackMirrorPersistence>
  flushIntervalMs?: number
}): PtyScrollbackMirror {
  return createPtySnapshotMirror({
    source,
    getPersistenceStore,
    persistSnapshot: (store, nodeId, snapshot) => store.writeNodeScrollback(nodeId, snapshot),
    flushIntervalMs,
  })
}

export function createPtyAgentPlaceholderMirror({
  source,
  getPersistenceStore,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}: {
  source: PtyScrollbackMirrorSnapshotSource
  getPersistenceStore: () => Promise<PtyAgentPlaceholderMirrorPersistence>
  flushIntervalMs?: number
}): PtyScrollbackMirror {
  return createPtySnapshotMirror({
    source,
    getPersistenceStore,
    persistSnapshot: (store, nodeId, snapshot) =>
      store.writeAgentNodePlaceholderScrollback(nodeId, snapshot),
    flushIntervalMs,
  })
}
