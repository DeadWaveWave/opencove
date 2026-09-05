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

type WorkspaceRecovery = TerminalRuntimeAvailabilitySnapshot & {
  attempt: number
  pending: number
  failed: boolean
}

export class TerminalRuntimeAvailability {
  private readonly recoveryByWorkspaceId = new Map<string, WorkspaceRecovery>()
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
      this.recoveryByWorkspaceId.set(workspaceId, {
        phase: 'initializing',
        epoch: 0,
        attempt: 0,
        pending: 0,
        failed: false,
      })
    }
  }

  public failStartup(): void {
    if (!this.shuttingDown && this.startupPhase === 'initializing') {
      this.startupPhase = 'unavailable'
    }
  }

  public recoverySnapshot(workspaceId: string): TerminalRuntimeAvailabilitySnapshot {
    if (this.shuttingDown) {
      const current = this.recoveryByWorkspaceId.get(workspaceId)
      return { phase: 'shutting-down', epoch: current?.epoch ?? 0 }
    }
    const current = this.recoveryByWorkspaceId.get(workspaceId)
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

    const snapshot = this.resolveSpawnAvailabilitySnapshot(workspaceId)
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
    if (this.shuttingDown || this.startupPhase === 'initializing') {
      this.assertSpawnAllowed(workspaceId, null)
    }

    const previous = this.recoveryByWorkspaceId.get(workspaceId)
    const joining = previous && previous.pending > 0
    const attempt = joining ? previous.attempt : ++this.nextAttempt
    const scope = Object.freeze({ workspaceId, attempt })
    this.recoveryScopes.add(scope)
    this.recoveryByWorkspaceId.set(workspaceId, {
      phase: 'initializing',
      epoch: previous?.epoch ?? 0,
      attempt,
      pending: (joining ? previous.pending : 0) + 1,
      failed: joining ? previous.failed : false,
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
    const current = this.recoveryByWorkspaceId.get(workspaceId)
    if (!current || current.attempt !== attempt) {
      return
    }
    const pending = current.pending - 1
    const failed = current.failed || phase === 'unavailable'
    const settledPhase = pending > 0 ? 'initializing' : failed ? 'unavailable' : 'ready'
    this.recoveryByWorkspaceId.set(workspaceId, {
      phase: settledPhase,
      epoch: settledPhase === 'ready' ? current.epoch + 1 : current.epoch,
      attempt,
      pending,
      failed,
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
    const current = this.recoveryByWorkspaceId.get(candidate.workspaceId)
    return (
      this.recoveryScopes.has(candidate) &&
      current?.phase === 'initializing' &&
      current.attempt === candidate.attempt
    )
  }

  private resolveSpawnAvailabilitySnapshot(
    workspaceId: string | null,
  ): TerminalRuntimeAvailabilitySnapshot {
    if (this.shuttingDown) {
      return { phase: 'shutting-down', epoch: 0 }
    }
    // A ready Worker can create independent sessions while old nodes reconcile. Recovery progress
    // and failure describe those old nodes, not the availability of the shared spawn service.
    if (this.startupPhase === 'ready') {
      return { phase: 'ready', epoch: 1 }
    }
    // After a failed startup scan, explicit reconciliation can repair only its own workspace.
    // Never use that result to open unscoped admission or authorize a different workspace.
    if (this.startupPhase === 'unavailable' && workspaceId) {
      const recovery = this.recoveryByWorkspaceId.get(workspaceId)
      if (recovery?.phase === 'ready') {
        return { phase: 'ready', epoch: recovery.epoch }
      }
    }
    return { phase: this.startupPhase, epoch: 0 }
  }
}
