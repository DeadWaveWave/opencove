import { createAppError } from '../../../shared/errors/appError'

export type TerminalRuntimePhase = 'initializing' | 'ready' | 'unavailable' | 'shutting-down'

export type TerminalRuntimeAvailabilitySnapshot = {
  phase: TerminalRuntimePhase
  epoch: number
}

export type TerminalRecoverySpawnScope = {
  readonly workspaceId: string
  readonly attempt: number
}

export type TerminalSpawnAdmission = Pick<TerminalRuntimeAvailability, 'assertSpawnAllowed'>
export type TerminalRecoverySpawnAdmission = Pick<TerminalRuntimeAvailability, 'reconcileWorkspace'>

type WorkspaceAvailability = TerminalRuntimeAvailabilitySnapshot & { attempt: number }

export class TerminalRuntimeAvailability {
  private readonly availabilityByWorkspaceId = new Map<string, WorkspaceAvailability>()
  private readonly recoveryScopes = new WeakSet<TerminalRecoverySpawnScope>()
  private startupPhase: 'initializing' | 'ready' | 'unavailable' = 'initializing'
  private shuttingDown = false
  private nextAttempt = 0

  public completeStartup(recoveryWorkspaceIds: readonly string[]): void {
    if (this.shuttingDown || this.startupPhase !== 'initializing') {
      return
    }
    this.startupPhase = 'ready'
    for (const workspaceId of new Set(recoveryWorkspaceIds)) {
      this.availabilityByWorkspaceId.set(workspaceId, {
        phase: 'initializing',
        epoch: 0,
        attempt: 0,
      })
    }
  }

  public failStartup(): void {
    if (!this.shuttingDown && this.startupPhase === 'initializing') {
      this.startupPhase = 'unavailable'
    }
  }

  public snapshot(workspaceId: string): TerminalRuntimeAvailabilitySnapshot {
    if (this.shuttingDown) {
      const current = this.availabilityByWorkspaceId.get(workspaceId)
      return { phase: 'shutting-down', epoch: current?.epoch ?? 0 }
    }
    const current = this.availabilityByWorkspaceId.get(workspaceId)
    if (current) {
      return { phase: current.phase, epoch: current.epoch }
    }
    if (this.startupPhase === 'ready') {
      return { phase: 'ready', epoch: 1 }
    }
    return { phase: this.startupPhase, epoch: 0 }
  }

  public assertSpawnAllowed(workspaceId: string | null, recoveryScope: unknown): void {
    if (this.isCurrentRecoveryScope(recoveryScope, workspaceId) && !this.shuttingDown) {
      return
    }

    const snapshot = workspaceId
      ? this.snapshot(workspaceId)
      : this.resolveUnscopedAvailabilitySnapshot()
    if (snapshot.phase === 'ready') {
      return
    }
    throw createAppError('terminal.runtime_not_ready', {
      details: { workspaceId, phase: snapshot.phase, epoch: snapshot.epoch },
      debugMessage: `Terminal runtime is ${snapshot.phase} for ${workspaceId ?? 'unscoped spawn'}.`,
    })
  }

  public async reconcileWorkspace<T>(
    workspaceId: string,
    operation: (scope: TerminalRecoverySpawnScope) => Promise<T>,
  ): Promise<T> {
    if (this.shuttingDown || this.startupPhase !== 'ready') {
      this.assertSpawnAllowed(workspaceId, null)
    }

    const previous = this.availabilityByWorkspaceId.get(workspaceId)
    const attempt = ++this.nextAttempt
    const scope = Object.freeze({ workspaceId, attempt })
    this.recoveryScopes.add(scope)
    this.availabilityByWorkspaceId.set(workspaceId, {
      phase: 'initializing',
      epoch: previous?.epoch ?? 0,
      attempt,
    })

    try {
      const result = await operation(scope)
      this.completeReconciliation(workspaceId, attempt, 'ready')
      return result
    } catch (error) {
      this.completeReconciliation(workspaceId, attempt, 'unavailable')
      throw error
    } finally {
      this.recoveryScopes.delete(scope)
    }
  }

  public beginShutdown(): void {
    this.shuttingDown = true
  }

  private completeReconciliation(
    workspaceId: string,
    attempt: number,
    phase: 'ready' | 'unavailable',
  ): void {
    if (this.shuttingDown) {
      return
    }
    const current = this.availabilityByWorkspaceId.get(workspaceId)
    if (!current || current.attempt !== attempt) {
      return
    }
    this.availabilityByWorkspaceId.set(workspaceId, {
      phase,
      epoch: phase === 'ready' ? current.epoch + 1 : current.epoch,
      attempt,
    })
  }

  private isCurrentRecoveryScope(scope: unknown, workspaceId: string | null): boolean {
    if (!scope || typeof scope !== 'object') {
      return false
    }
    const candidate = scope as TerminalRecoverySpawnScope
    if (workspaceId !== null && candidate.workspaceId !== workspaceId) {
      return false
    }
    const current = this.availabilityByWorkspaceId.get(candidate.workspaceId)
    return (
      this.recoveryScopes.has(candidate) &&
      current?.phase === 'initializing' &&
      current.attempt === candidate.attempt
    )
  }

  private resolveUnscopedAvailabilitySnapshot(): TerminalRuntimeAvailabilitySnapshot {
    if (this.shuttingDown) {
      return { phase: 'shutting-down', epoch: 0 }
    }
    if (this.startupPhase !== 'ready') {
      return { phase: this.startupPhase, epoch: 0 }
    }
    const blocking = [...this.availabilityByWorkspaceId.values()].find(
      availability => availability.phase !== 'ready',
    )
    return blocking
      ? { phase: blocking.phase, epoch: blocking.epoch }
      : { phase: 'ready', epoch: 1 }
  }
}
