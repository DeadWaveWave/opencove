export class RemotePtyRecoveryBlockedError extends Error {
  public constructor(message = 'Authoritative remote PTY presentation snapshot unavailable') {
    super(message)
    this.name = 'RemotePtyRecoveryBlockedError'
  }
}
