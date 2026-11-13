/** Invocation identity tombstones never depend on the replay log. Once history is
 * incomplete, prompting stays disabled until the invocation ends. */
export const CLAUDE_LIFECYCLE_LIMIT = 512
export const CLAUDE_IDENTITY_LIMIT = 256
export const CLAUDE_FACT_LIMIT = 640
export class ClaudeJournalHistory {
  private identities = new Map<string, number>()
  private truncated = false
  get incomplete(): boolean {
    return this.truncated
  }
  remember(id: string, at: number): boolean {
    const first = this.identities.get(id)
    if (first === undefined && this.identities.size === CLAUDE_IDENTITY_LIMIT) {
      this.truncate()
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
  truncate(): void {
    this.truncated = true
  }
  dispose(): void {
    this.identities.clear()
    this.truncated = false
  }
}
