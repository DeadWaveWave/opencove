import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'

export type PtySessionNodeBinding = {
  sessionId: string
  nodeId: string
}

export type PtyScrollbackMirrorPersistence = Pick<PersistenceStore, 'writeNodeScrollback'>

export type PtyScrollbackMirrorSnapshotSource = {
  snapshot: (sessionId: string) => string
}

export type PtyScrollbackMirror = {
  setBindings: (bindings: PtySessionNodeBinding[]) => void
  dispose: () => void
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

export function createPtyScrollbackMirror({
  source,
  getPersistenceStore,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}: {
  source: PtyScrollbackMirrorSnapshotSource
  getPersistenceStore: () => Promise<PtyScrollbackMirrorPersistence>
  flushIntervalMs?: number
}): PtyScrollbackMirror {
  let disposed = false
  let flushTimer: NodeJS.Timeout | null = null
  let flushInFlight = false

  const nodeIdsBySessionId = new Map<string, Set<string>>()
  const lastFingerprintBySessionId = new Map<string, SnapshotFingerprint>()

  const flush = async (): Promise<void> => {
    if (disposed || flushInFlight) {
      return
    }

    if (nodeIdsBySessionId.size === 0) {
      return
    }

    flushInFlight = true

    try {
      const store = await getPersistenceStore()
      const writes: Promise<unknown>[] = []

      for (const [sessionId, nodeIds] of nodeIdsBySessionId.entries()) {
        if (nodeIds.size === 0) {
          continue
        }

        const snapshot = source.snapshot(sessionId)
        if (snapshot.length === 0) {
          continue
        }

        const fingerprint = fingerprintSnapshot(snapshot)
        const previous = lastFingerprintBySessionId.get(sessionId)
        if (previous && areFingerprintsEqual(previous, fingerprint)) {
          continue
        }

        lastFingerprintBySessionId.set(sessionId, fingerprint)

        for (const nodeId of nodeIds) {
          writes.push(store.writeNodeScrollback(nodeId, snapshot))
        }
      }

      if (writes.length > 0) {
        await Promise.allSettled(writes)
      }
    } catch {
      // ignore
    } finally {
      flushInFlight = false
    }
  }

  const startTimerIfNeeded = (): void => {
    if (flushTimer || disposed) {
      return
    }

    flushTimer = setInterval(() => {
      void flush()
    }, flushIntervalMs)
  }

  return {
    setBindings: bindings => {
      if (disposed) {
        return
      }

      nodeIdsBySessionId.clear()
      lastFingerprintBySessionId.clear()

      for (const binding of bindings) {
        const nodeIds = nodeIdsBySessionId.get(binding.sessionId) ?? new Set<string>()
        nodeIds.add(binding.nodeId)
        nodeIdsBySessionId.set(binding.sessionId, nodeIds)
      }

      if (nodeIdsBySessionId.size === 0) {
        return
      }

      startTimerIfNeeded()
      void flush()
    },
    dispose: () => {
      disposed = true

      if (flushTimer) {
        clearInterval(flushTimer)
        flushTimer = null
      }

      nodeIdsBySessionId.clear()
      lastFingerprintBySessionId.clear()
    },
  }
}
