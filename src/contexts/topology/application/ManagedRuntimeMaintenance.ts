/** Owns admission synchronously, including the idle-check/new-command race. */
export class ManagedRuntimeMaintenance {
  private accepted = 0
  private lease: string | null
  public phase: 'active' | 'candidate' | 'maintenance' | 'stopping'

  public constructor(
    private readonly isIdle: () => boolean,
    activation: string | null = null,
  ) {
    this.lease = activation
    this.phase = activation ? 'candidate' : 'active'
  }

  public enter(): () => void {
    if (this.phase !== 'active') {
      throw new Error('Worker is in managed runtime maintenance.')
    }
    this.accepted += 1
    let released = false
    return () => {
      if (!released) {
        this.accepted -= 1
      }
      released = true
    }
  }

  public get activationId(): string | null {
    return this.phase === 'candidate' ? this.lease : null
  }

  public acquire(lease: string): boolean {
    if (this.phase === 'maintenance' && this.lease === lease) {
      return true
    }
    if (this.phase !== 'active' || this.accepted > 0 || !this.isIdle()) {
      return false
    }
    this.lease = lease
    this.phase = 'maintenance'
    return true
  }

  public release(lease: string): void {
    this.assertLease(lease, 'maintenance')
    this.lease = null
    this.phase = 'active'
  }

  public commitStop(lease: string): void {
    if (this.phase !== 'candidate') {
      this.assertLease(lease, 'maintenance')
    } else {
      this.assertLease(lease, 'candidate')
    }
    if (this.accepted > 0 || !this.isIdle()) {
      throw new Error('Worker has active work.')
    }
    this.phase = 'stopping'
  }

  public activate(lease: string): void {
    this.assertLease(lease, 'candidate')
    this.lease = null
    this.phase = 'active'
  }

  private assertLease(lease: string, phase: typeof this.phase): void {
    if (this.phase !== phase || !lease || this.lease !== lease) {
      throw new Error('Managed runtime maintenance lease is no longer current.')
    }
  }
}
