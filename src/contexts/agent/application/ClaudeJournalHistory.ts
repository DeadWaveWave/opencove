/** Invocation identity tombstones never depend on the replay log. Once history is
 * incomplete, only a fresh current Submit–Stop pair may certify idle; empty clear stays disabled. */
export const CLAUDE_LIFECYCLE_LIMIT = 64
export const CLAUDE_IDENTITY_LIMIT = 128
export class ClaudeJournalHistory {
  private identities = new Map<string, number>()
  private truncatedAt?: number
  get incomplete(): boolean {
    return this.truncatedAt !== undefined
  }
  remember(id: string, at: number, order: number): boolean {
    const first = this.identities.get(id)
    if (first === undefined && this.identities.size === CLAUDE_IDENTITY_LIMIT) {
      this.truncate(order)
    } else {
      this.identities.set(id, Math.min(first ?? at, at))
    }
    return this.possiblyReused(id, at)
  }
  possiblyReused(id: string, at: number): boolean {
    return this.incomplete || (this.identities.get(id) ?? at) < at
  }
  knows(id: string): boolean {
    return this.identities.has(id)
  }
  truncate(order: number): void {
    this.truncatedAt ??= order
  }
  qualifies(order: number | undefined): boolean {
    return !this.incomplete || (order !== undefined && order > this.truncatedAt!)
  }
  dispose(): void {
    this.identities.clear()
    this.truncatedAt = undefined
  }
}
