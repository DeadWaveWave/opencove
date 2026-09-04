import type { AttachTerminalInput } from '@shared/contracts/dto'
import { normalizeBrowserPtyAttachAfterSeq } from './BrowserPtyWire'
import {
  BrowserPtyAttachCoordinator,
  parseBrowserPtyAuthority,
  type BrowserPtyAttachResult,
} from './BrowserPtyAttachCoordinator'
import { BrowserPtySocketLifecycle, type BrowserPtySocketLease } from './BrowserPtySocketLifecycle'

export type BrowserAttachedSessionState = {
  lastSeq: number
  role: 'viewer' | 'controller'
  authorityEpoch: number | null
  nextLegacyRevision: number
}

function createState(): BrowserAttachedSessionState {
  return { lastSeq: 0, role: 'viewer', authorityEpoch: null, nextLegacyRevision: 0 }
}

export class BrowserPtySessionAuthority {
  public readonly sessions = new Map<string, BrowserAttachedSessionState>()
  private readonly attaches = new BrowserPtyAttachCoordinator()
  private readonly generationBySessionId = new Map<string, number>()

  public track(input: AttachTerminalInput): BrowserAttachedSessionState {
    const { state } = this.ensureTracked(input.sessionId)
    const afterSeq = normalizeBrowserPtyAttachAfterSeq(input.afterSeq)
    if (afterSeq !== null) {
      state.lastSeq = Math.max(state.lastSeq, afterSeq)
    }
    return state
  }

  public onConnected(lease: BrowserPtySocketLease, send: (payload: unknown) => void): void {
    for (const [sessionId, state] of this.sessions) {
      state.authorityEpoch = null
      const pending = this.attaches.begin({ sessionId, lease })
      if (pending.shouldSend) {
        send(this.createAttachPayload(sessionId, state))
      }
      void pending.result.catch(() => undefined)
    }
  }

  public async ensureAttached(
    lifecycle: BrowserPtySocketLifecycle,
    sessionId: string,
  ): Promise<{ lease: BrowserPtySocketLease; result: BrowserPtyAttachResult }> {
    const tracked = this.ensureTracked(sessionId)
    const lease = await lifecycle.ensureReady()
    this.assertTracked(sessionId, tracked)
    const pending = this.attaches.begin({ sessionId, lease })
    if (
      pending.shouldSend &&
      !lifecycle.sendIfCurrent(lease, this.createAttachPayload(sessionId, tracked.state))
    ) {
      const error = new Error('PTY stream socket changed before attach')
      this.attaches.rejectSession(sessionId, error)
      throw error
    }
    const result = await pending.result
    this.assertTracked(sessionId, tracked)
    return { lease, result }
  }

  public noteHelloAck(lease: BrowserPtySocketLease): void {
    this.attaches.noteHelloAck(lease)
  }

  public noteAttached(
    lease: BrowserPtySocketLease,
    record: Record<string, unknown>,
  ): BrowserPtyAttachResult | null {
    const result = this.attaches.noteAttached(lease, record)
    if (!result) {
      return null
    }
    const state = this.sessions.get(result.sessionId) ?? createState()
    state.role = result.authority.role
    state.authorityEpoch = result.authority.epoch
    this.sessions.set(result.sessionId, state)
    return result
  }

  public noteControlChanged(
    lease: BrowserPtySocketLease,
    sessionId: string,
    record: Record<string, unknown>,
  ): boolean {
    const state = this.sessions.get(sessionId)
    const authority = parseBrowserPtyAuthority(record)
    if (!state || !authority) {
      return false
    }
    state.role = authority.role
    state.authorityEpoch = authority.epoch
    this.attaches.updateAuthority(lease, sessionId, authority)
    return true
  }

  public retireLease(lease: BrowserPtySocketLease, error: Error): void {
    this.sessions.forEach(state => {
      state.authorityEpoch = null
    })
    this.attaches.retireLease(lease, error)
  }

  public remove(sessionId: string, error: Error): void {
    this.generationBySessionId.set(sessionId, (this.generationBySessionId.get(sessionId) ?? 0) + 1)
    this.sessions.delete(sessionId)
    this.attaches.rejectSession(sessionId, error)
  }

  private ensureTracked(sessionId: string): {
    state: BrowserAttachedSessionState
    generation: number
  } {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return { state: existing, generation: this.generationBySessionId.get(sessionId) ?? 0 }
    }
    const state = createState()
    const generation = (this.generationBySessionId.get(sessionId) ?? 0) + 1
    this.sessions.set(sessionId, state)
    this.generationBySessionId.set(sessionId, generation)
    return { state, generation }
  }

  private assertTracked(
    sessionId: string,
    tracked: { state: BrowserAttachedSessionState; generation: number },
  ): void {
    if (
      this.sessions.get(sessionId) !== tracked.state ||
      this.generationBySessionId.get(sessionId) !== tracked.generation
    ) {
      throw new Error('Terminal session detached before attach completed')
    }
  }

  private createAttachPayload(
    sessionId: string,
    state: BrowserAttachedSessionState,
  ): Record<string, unknown> {
    return {
      type: 'attach',
      sessionId,
      afterSeq: state.lastSeq > 0 ? state.lastSeq : undefined,
      role: 'controller',
    }
  }
}
