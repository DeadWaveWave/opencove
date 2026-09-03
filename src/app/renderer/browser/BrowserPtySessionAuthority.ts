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

  public track(input: AttachTerminalInput): BrowserAttachedSessionState {
    const state = this.sessions.get(input.sessionId) ?? createState()
    const afterSeq = normalizeBrowserPtyAttachAfterSeq(input.afterSeq)
    if (afterSeq !== null) {
      state.lastSeq = Math.max(state.lastSeq, afterSeq)
    }
    this.sessions.set(input.sessionId, state)
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
    const state = this.sessions.get(sessionId) ?? createState()
    this.sessions.set(sessionId, state)
    const lease = await lifecycle.ensureReady()
    const pending = this.attaches.begin({ sessionId, lease })
    if (
      pending.shouldSend &&
      !lifecycle.sendIfCurrent(lease, this.createAttachPayload(sessionId, state))
    ) {
      const error = new Error('PTY stream socket changed before attach')
      this.attaches.rejectSession(sessionId, error)
      throw error
    }
    return { lease, result: await pending.result }
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
    this.sessions.delete(sessionId)
    this.attaches.rejectSession(sessionId, error)
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
