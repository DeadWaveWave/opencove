/** Preserve acceptance failures ahead of later health-check, attachment, or teardown failures. */
export class AcceptanceFailures {
  private readonly failures: { label: string; error: unknown }[] = []
  add(label: string, error: unknown): void {
    this.failures.push({ label, error })
  }
  async capture(label: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.add(label, error)
    }
  }
  throwIfAny(): void {
    if (this.failures.length === 1) {
      throw this.failures[0].error
    }
    if (this.failures.length > 1) {
      throw new AggregateError(
        this.failures.map(item => item.error),
        `Codex acceptance failures (primary first): ${this.failures.map(item => item.label).join(', ')}`,
      )
    }
  }
}
