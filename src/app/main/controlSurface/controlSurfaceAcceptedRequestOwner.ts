export class ControlSurfaceAcceptedRequestOwner {
  private readonly operations = new Set<Promise<void>>()
  private sealed = false

  public track(operation: Promise<void>): void {
    if (this.sealed) {
      throw new Error('Control Surface accepted-request owner is sealed.')
    }
    this.operations.add(operation)
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation),
    )
  }

  public async sealAndDrain(): Promise<void> {
    this.sealed = true
    await Promise.allSettled([...this.operations])
  }
}
