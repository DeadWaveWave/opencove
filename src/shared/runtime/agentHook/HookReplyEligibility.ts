export interface HookReplyReceipt {
  accept(): void
  reject(): void
  isCurrent(): boolean
}

/** Orders reply claims, not provider state. Semantic acceptance still belongs to emit. */
export class HookReplyEligibility {
  private sequence = 0
  private currentLifecycle = 0

  begin(eventName: string | undefined): HookReplyReceipt {
    const sequence = ++this.sequence
    const lifecycle = eventName === 'SessionStart' || eventName === 'SessionEnd'
    let rejected = false
    return {
      accept: () => {
        if (lifecycle && !rejected) {
          this.currentLifecycle = Math.max(this.currentLifecycle, sequence)
        }
      },
      reject: () => {
        rejected = true
      },
      isCurrent: () => !rejected && this.currentLifecycle === sequence,
    }
  }
}
