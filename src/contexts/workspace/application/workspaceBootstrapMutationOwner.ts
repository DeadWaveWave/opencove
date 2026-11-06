/** Owns allocation through commit/failure, shared by both bootstrap commands. */
export class WorkspaceBootstrapMutationOwner {
  private tail: Promise<void> = Promise.resolve()

  run<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
