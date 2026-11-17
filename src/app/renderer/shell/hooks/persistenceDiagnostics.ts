import type { PersistWriteResult, RuntimeDiagnosticsLogInput } from '@shared/contracts/dto'

export function persistenceFailureNoticeKey(result: Extract<PersistWriteResult, { ok: false }>) {
  return result.outcome === 'unknown'
    ? 'persistence.saveUnconfirmed'
    : result.error.code === 'persistence.owned_node_identity_conflict'
      ? 'persistence.ownedIdentityRestored'
      : result.reason === 'unavailable'
        ? 'persistence.unavailable'
        : result.reason === 'quota' || result.reason === 'payload_too_large'
          ? 'persistence.limitExceeded'
          : result.reason === 'io'
            ? 'persistence.ioFailed'
            : 'persistence.failed'
}

/** One observer per hook lifetime; diagnostic state never participates in persistence decisions. */
export function createPersistenceDiagnostics(
  log: (input: RuntimeDiagnosticsLogInput) => void | Promise<void>,
) {
  const signatures = new Map<string, { lastLoggedAt: number; suppressedCount: number }>()
  let failedCount = 0
  let firstFailedAt: number | null = null

  return (result: PersistWriteResult, noticeKey: string | null, now: number): void => {
    try {
      let input: RuntimeDiagnosticsLogInput
      if (result.ok) {
        if (firstFailedAt === null) {
          return
        }
        input = {
          source: 'renderer-persistence',
          level: 'info',
          event: 'persistence-write-recovered',
          message: 'Workspace save recovered.',
          details: { failedCount, firstFailedAt: new Date(firstFailedAt).toISOString() },
        }
        failedCount = 0
        firstFailedAt = null
        signatures.clear()
      } else {
        firstFailedAt ??= now
        failedCount += 1
        const errorCode = result.error.code
        const outcome = result.outcome ?? null
        const debugMessage = result.error.debugMessage ?? null
        const signature = JSON.stringify([errorCode, result.reason, outcome, debugMessage])
        const previous = signatures.get(signature)
        if (previous && now - previous.lastLoggedAt < 60_000) {
          previous.suppressedCount += 1
          return
        }
        const details = result.error.details
        const tag =
          details && typeof details === 'object' && 'stage' in details ? details.stage : null
        const stage =
          tag === 'worker-store' ||
          tag === 'worker-envelope' ||
          tag === 'endpoint-unavailable' ||
          tag === 'transport'
            ? tag
            : 'renderer'
        input = {
          source: 'renderer-persistence',
          level: 'error',
          event: 'persistence-write-failed',
          message: 'Workspace save failed.',
          details: {
            errorCode,
            reason: result.reason,
            outcome,
            debugMessage,
            stage,
            noticeKey,
            suppressedCount: previous?.suppressedCount ?? 0,
          },
        }
        signatures.set(signature, { lastLoggedAt: now, suppressedCount: 0 })
      }
      void Promise.resolve(log(input)).catch(() => undefined)
    } catch {
      // Logging must never change the write result or prevent its notice from being shown.
    }
  }
}
