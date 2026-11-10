import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export interface SessionGrantIdentity {
  readonly projectId: string
  readonly spaceId: string
  readonly nodeId: string | null
  readonly sessionId: string
}

export interface SessionGrant extends SessionGrantIdentity {
  readonly grantId: string
  readonly tier: 'read' | 'interact'
  readonly createdAt: string
}

type StoredGrant = SessionGrant & { readonly tokenHash: string }

function hash(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

/** Owned by the hosting Worker, never shared with a renderer or persisted as plaintext. */
export class SessionGrantRegistry {
  readonly #grants = new Map<string, StoredGrant>()

  readonly #revocations = new Map<string, Set<() => void>>()

  public constructor(private readonly sessionExists: (sessionId: string) => boolean) {}

  public issue(
    identity: SessionGrantIdentity,
    now = new Date(),
  ): { token: string; grant: SessionGrant } {
    if (!this.sessionExists(identity.sessionId)) {
      throw new Error('Cannot issue a grant for an absent session.')
    }
    const token = randomBytes(32).toString('base64url')
    const grant: SessionGrant = Object.freeze({
      projectId: identity.projectId,
      spaceId: identity.spaceId,
      nodeId: identity.nodeId,
      sessionId: identity.sessionId,
      grantId: randomUUID(),
      tier: 'interact',
      createdAt: now.toISOString(),
    })
    this.#grants.set(grant.grantId, { ...grant, tokenHash: hash(token).toString('hex') })
    return { token, grant }
  }

  public reserve(identity: Omit<SessionGrantIdentity, 'sessionId'>): {
    token: string
    commit: (sessionId: string) => void
    cancel: () => void
  } {
    const token = randomBytes(32).toString('base64url')
    const grantId = randomUUID()
    const stored: StoredGrant = {
      ...identity,
      sessionId: '',
      grantId,
      tier: 'interact',
      createdAt: new Date().toISOString(),
      tokenHash: hash(token).toString('hex'),
    }
    this.#grants.set(grantId, stored)
    return {
      token,
      commit: sessionId => {
        if (!this.#grants.has(grantId) || !this.sessionExists(sessionId)) {
          this.revoke(grantId)
          throw new Error('Session grant reservation is no longer active.')
        }
        this.#grants.set(grantId, { ...stored, sessionId })
      },
      cancel: () => this.revoke(grantId),
    }
  }

  public verify(token: string): SessionGrant | null {
    const candidate = hash(token)
    for (const [id, stored] of this.#grants) {
      if (!stored.sessionId) {
        continue
      }
      if (!this.sessionExists(stored.sessionId)) {
        this.revoke(id)
        continue
      }
      if (timingSafeEqual(candidate, Buffer.from(stored.tokenHash, 'hex'))) {
        const { tokenHash: _tokenHash, ...grant } = stored
        return Object.freeze(grant)
      }
    }
    return null
  }

  public revokeSession(sessionId: string): void {
    for (const [id, grant] of this.#grants) {
      if (grant.sessionId === sessionId) {
        this.revoke(id)
      }
    }
  }

  public isActive(grantId: string): boolean {
    const grant = this.#grants.get(grantId)
    if (!grant) {
      return false
    }
    if (!this.sessionExists(grant.sessionId)) {
      this.revoke(grantId)
      return false
    }
    return true
  }

  /** Registers before checking liveness, closing the subscribe/revoke gap. */
  public onRevoke(grantId: string, close: () => void): () => void {
    const listeners = this.#revocations.get(grantId) ?? new Set<() => void>()
    listeners.add(close)
    this.#revocations.set(grantId, listeners)
    if (!this.isActive(grantId) && listeners.has(close)) {
      listeners.delete(close)
      this.#revocations.delete(grantId)
      close()
    }
    return () => {
      listeners.delete(close)
      if (listeners.size === 0) {
        this.#revocations.delete(grantId)
      }
    }
  }

  private revoke(grantId: string): void {
    this.#grants.delete(grantId)
    const listeners = this.#revocations.get(grantId)
    this.#revocations.delete(grantId)
    for (const close of listeners ?? []) {
      try {
        listeners?.delete(close)
        close()
      } catch {
        /* One failed transport must not prevent other revocations. */
      }
    }
  }

  public clear(): void {
    for (const id of this.#grants.keys()) {
      this.revoke(id)
    }
  }
}
