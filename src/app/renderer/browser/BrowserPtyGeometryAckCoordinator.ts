import type { TerminalGeometryCommitResult } from '@shared/contracts/dto'

type PendingResize = {
  sessionId: string
  operationId: string
  legacyRevision: number | null
  resolve: (result: TerminalGeometryCommitResult) => void
  reject: (error: Error) => void
  timer: number
}

let browserGeometryOperationSequence = 0

function createGeometryOperationId(): string {
  browserGeometryOperationSequence += 1
  return `browser-${Date.now()}-${browserGeometryOperationSequence}`
}

function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.floor(value)
}

function parseGeometryCommitResult(
  record: Record<string, unknown>,
): TerminalGeometryCommitResult | null {
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
  const operationId = typeof record.operationId === 'string' ? record.operationId : null
  const status =
    record.status === 'accepted' ||
    record.status === 'rejected_not_controller' ||
    record.status === 'rejected_stale_authority' ||
    record.status === 'superseded' ||
    record.status === 'session_not_found' ||
    record.status === 'runtime_failed'
      ? record.status
      : null
  if (!sessionId || !operationId || !status) {
    return null
  }

  const rawGeometry =
    record.geometry && typeof record.geometry === 'object' && !Array.isArray(record.geometry)
      ? (record.geometry as Record<string, unknown>)
      : null
  const cols = normalizeOptionalPositiveInt(rawGeometry?.cols)
  const rows = normalizeOptionalPositiveInt(rawGeometry?.rows)
  const revision = normalizeOptionalPositiveInt(rawGeometry?.revision)
  const geometry = rawGeometry && cols !== null && rows !== null ? { cols, rows, revision } : null
  const rawAuthority =
    record.authority && typeof record.authority === 'object' && !Array.isArray(record.authority)
      ? (record.authority as Record<string, unknown>)
      : null
  const role =
    rawAuthority?.role === 'controller' || rawAuthority?.role === 'viewer'
      ? rawAuthority.role
      : null
  const epoch =
    typeof rawAuthority?.epoch === 'number' &&
    Number.isFinite(rawAuthority.epoch) &&
    rawAuthority.epoch >= 0
      ? Math.floor(rawAuthority.epoch)
      : null

  return {
    sessionId,
    operationId,
    status,
    changed: record.changed === true,
    geometry,
    authority: role && epoch !== null ? { role, epoch } : null,
  }
}

export class BrowserPtyGeometryAckCoordinator {
  private readonly pendingBySessionId = new Map<string, Map<string, PendingResize>>()
  private ackSupported: boolean | null = null

  public get typedAckSupported(): boolean | null {
    return this.ackSupported
  }

  public noteHelloAck(record: Record<string, unknown>): void {
    const capabilities =
      record.capabilities && typeof record.capabilities === 'object'
        ? (record.capabilities as Record<string, unknown>)
        : null
    this.ackSupported = capabilities?.geometryCommitAck === 1
  }

  public begin(input: {
    sessionId: string
    operationId?: string | null
    legacyRevision: number | null
  }): { operationId: string; result: Promise<TerminalGeometryCommitResult> } {
    const operationId = input.operationId?.trim() || createGeometryOperationId()
    const pendingByOperationId =
      this.pendingBySessionId.get(input.sessionId) ?? new Map<string, PendingResize>()
    if (pendingByOperationId.has(operationId)) {
      throw new Error(`Duplicate terminal geometry operation: ${input.sessionId}/${operationId}`)
    }

    const result = new Promise<TerminalGeometryCommitResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.take(input.sessionId, operationId)?.reject(
          new Error(`Timed out waiting for terminal geometry ACK: ${input.sessionId}`),
        )
      }, 3_000)
      pendingByOperationId.set(operationId, {
        sessionId: input.sessionId,
        operationId,
        legacyRevision: input.legacyRevision,
        resolve,
        reject,
        timer,
      })
      this.pendingBySessionId.set(input.sessionId, pendingByOperationId)
    })
    return { operationId, result }
  }

  public resolveTyped(record: Record<string, unknown>): TerminalGeometryCommitResult | null {
    const result = parseGeometryCommitResult(record)
    if (!result) {
      return null
    }
    const pending = this.take(result.sessionId, result.operationId)
    if (!pending) {
      return null
    }
    pending.resolve(result)
    return result
  }

  public rejectLegacySession(sessionId: string, message: string): void {
    if (this.ackSupported === true) {
      return
    }
    const pending = this.pendingBySessionId.get(sessionId)?.values().next().value
    if (pending) {
      this.reject(sessionId, pending.operationId, new Error(message))
    }
  }

  public resolveLegacyGeometry(input: {
    sessionId: string
    cols: number
    rows: number
    revision: number
    authority: TerminalGeometryCommitResult['authority']
  }): void {
    if (this.ackSupported !== false) {
      return
    }
    const pending = [...(this.pendingBySessionId.get(input.sessionId)?.values() ?? [])].find(
      candidate => candidate.legacyRevision === input.revision,
    )
    if (!pending) {
      return
    }
    const taken = this.take(input.sessionId, pending.operationId)
    taken?.resolve({
      sessionId: input.sessionId,
      operationId: pending.operationId,
      status: 'accepted',
      changed: true,
      geometry: {
        cols: input.cols,
        rows: input.rows,
        revision: input.revision,
      },
      authority: input.authority,
    })
  }

  public reject(sessionId: string, operationId: string, error: Error): void {
    this.take(sessionId, operationId)?.reject(error)
  }

  public rejectAll(error: Error): void {
    for (const [sessionId, pendingByOperationId] of [...this.pendingBySessionId.entries()]) {
      for (const operationId of [...pendingByOperationId.keys()]) {
        this.reject(sessionId, operationId, error)
      }
    }
  }

  private take(sessionId: string, operationId: string): PendingResize | null {
    const pendingByOperationId = this.pendingBySessionId.get(sessionId)
    const pending = pendingByOperationId?.get(operationId) ?? null
    if (!pending) {
      return null
    }
    window.clearTimeout(pending.timer)
    pendingByOperationId?.delete(operationId)
    if (pendingByOperationId?.size === 0) {
      this.pendingBySessionId.delete(sessionId)
    }
    return pending
  }
}
