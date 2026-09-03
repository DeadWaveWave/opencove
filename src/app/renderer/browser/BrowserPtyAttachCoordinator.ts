import type { TerminalGeometryAuthority } from '@shared/contracts/dto'
import type { BrowserPtySocketLease } from './BrowserPtySocketLifecycle'

export type BrowserPtyAttachResult = {
  sessionId: string
  authority: TerminalGeometryAuthority
}

type PendingAttach = {
  lease: BrowserPtySocketLease
  result: Promise<BrowserPtyAttachResult>
  resolve: (value: BrowserPtyAttachResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function parseBrowserPtyAuthority(
  record: Record<string, unknown>,
): TerminalGeometryAuthority | null {
  const role = record.role
  const epoch = record.authorityEpoch
  if (
    (role !== 'viewer' && role !== 'controller') ||
    typeof epoch !== 'number' ||
    !Number.isSafeInteger(epoch) ||
    epoch < 0
  ) {
    return null
  }
  return { role, epoch }
}

export class BrowserPtyAttachCoordinator {
  private readonly helloAcknowledgedLeases = new WeakSet<BrowserPtySocketLease>()
  private readonly pendingBySessionId = new Map<string, PendingAttach>()
  private readonly resolvedBySessionId = new Map<
    string,
    { lease: BrowserPtySocketLease; result: BrowserPtyAttachResult }
  >()

  public constructor(private readonly timeoutMs = 10_000) {}

  public begin(input: { sessionId: string; lease: BrowserPtySocketLease }): {
    result: Promise<BrowserPtyAttachResult>
    shouldSend: boolean
  } {
    const resolved = this.resolvedBySessionId.get(input.sessionId)
    if (resolved?.lease === input.lease) {
      return { result: Promise.resolve(resolved.result), shouldSend: false }
    }
    if (resolved) {
      this.resolvedBySessionId.delete(input.sessionId)
    }

    const existing = this.pendingBySessionId.get(input.sessionId)
    if (existing?.lease === input.lease) {
      return { result: existing.result, shouldSend: false }
    }
    if (existing) {
      this.rejectPending(input.sessionId, existing, new Error('PTY attach lease was replaced.'))
    }

    let resolveResult!: (value: BrowserPtyAttachResult) => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<BrowserPtyAttachResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const pending: PendingAttach = {
      lease: input.lease,
      result,
      resolve: resolveResult,
      reject: rejectResult,
      timer: setTimeout(() => {
        this.rejectPending(
          input.sessionId,
          pending,
          new Error(`Timed out waiting for PTY attach: ${input.sessionId}`),
        )
      }, this.timeoutMs),
    }
    this.pendingBySessionId.set(input.sessionId, pending)
    return { result, shouldSend: true }
  }

  public noteHelloAck(lease: BrowserPtySocketLease): void {
    this.helloAcknowledgedLeases.add(lease)
  }

  public noteAttached(
    lease: BrowserPtySocketLease,
    record: Record<string, unknown>,
  ): BrowserPtyAttachResult | null {
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const authority = parseBrowserPtyAuthority(record)
    if (!sessionId || !authority) {
      return null
    }
    const pending = this.pendingBySessionId.get(sessionId)
    if (!pending || pending.lease !== lease || !this.helloAcknowledgedLeases.has(lease)) {
      return null
    }

    clearTimeout(pending.timer)
    this.pendingBySessionId.delete(sessionId)
    const result = { sessionId, authority }
    this.resolvedBySessionId.set(sessionId, { lease, result })
    pending.resolve(result)
    return result
  }

  public updateAuthority(
    lease: BrowserPtySocketLease,
    sessionId: string,
    authority: TerminalGeometryAuthority,
  ): void {
    const resolved = this.resolvedBySessionId.get(sessionId)
    if (resolved?.lease === lease) {
      this.resolvedBySessionId.set(sessionId, {
        lease,
        result: { sessionId, authority },
      })
    }
  }

  public retireLease(lease: BrowserPtySocketLease, error: Error): void {
    for (const [sessionId, pending] of this.pendingBySessionId) {
      if (pending.lease === lease) {
        this.rejectPending(sessionId, pending, error)
      }
    }
    for (const [sessionId, resolved] of this.resolvedBySessionId) {
      if (resolved.lease === lease) {
        this.resolvedBySessionId.delete(sessionId)
      }
    }
  }

  public rejectSession(sessionId: string, error: Error): void {
    const pending = this.pendingBySessionId.get(sessionId)
    if (pending) {
      this.rejectPending(sessionId, pending, error)
    }
    this.resolvedBySessionId.delete(sessionId)
  }

  private rejectPending(sessionId: string, pending: PendingAttach, error: Error): void {
    if (this.pendingBySessionId.get(sessionId) !== pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingBySessionId.delete(sessionId)
    pending.reject(error)
  }
}
