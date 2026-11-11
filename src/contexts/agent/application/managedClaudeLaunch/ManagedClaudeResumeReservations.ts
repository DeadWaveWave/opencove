import { createAppError } from '../../../../shared/errors/appError'
import type { ManagedClaudeLaunchAttempt } from './types'
import type { ManagedClaudeDrainResult } from './qualification'

/** Owner-held request order, independent of runtime admission and retained evidence authority. */
export class ManagedClaudeResumeReservations {
  private readonly drains = new Map<string, Promise<ManagedClaudeDrainResult>>()
  private readonly requests = new Map<string, symbol>()
  constructor(
    private readonly reserve: (nodeId: string) => ManagedClaudeLaunchAttempt,
    private readonly hasPending: (nodeId: string) => boolean,
    private readonly drain: (input: {
      nodeId: string
      deadlineAt: number
    }) => Promise<ManagedClaudeDrainResult>,
    private readonly available: () => boolean,
  ) {}
  invalidate(nodeId: string): void {
    this.requests.delete(nodeId)
    this.drains.delete(nodeId)
  }
  clear(): void {
    this.requests.clear()
    this.drains.clear()
  }
  resume(
    nodeId: string,
    assertActive: () => void = () => {},
  ): ManagedClaudeLaunchAttempt | Promise<ManagedClaudeLaunchAttempt> {
    assertActive()
    const request = Symbol(nodeId)
    this.requests.set(nodeId, request)
    const assertCurrent = () => {
      assertActive()
      if (!this.available() || this.requests.get(nodeId) !== request) {
        throw createAppError('agent.managed_launch_rejected', {
          details: { nodeId, reason: 'superseded' },
        })
      }
    }
    const reserve = () => {
      assertCurrent()
      return this.reserve(nodeId)
    }
    // Preserve W8's synchronous reservation when no qualification work needs draining.
    if (!this.hasPending(nodeId)) {
      return reserve()
    }
    let draining = this.drains.get(nodeId)
    if (!draining) {
      draining = this.drain({ nodeId, deadlineAt: performance.now() + 5000 })
      this.drains.set(nodeId, draining)
      const current = draining
      const release = () => {
        if (this.drains.get(nodeId) === current) {
          this.drains.delete(nodeId)
        }
      }
      void draining.then(release, release)
    }
    return draining.then(result => {
      assertCurrent()
      if (result.status === 'degraded') {
        throw createAppError('agent.managed_launch_rejected', {
          details: { nodeId, reason: 'resumeBindingDrainExpired' },
          debugMessage:
            'The latest Claude conversation could not be confirmed. Try resuming again before closing this agent.',
        })
      }
      return reserve()
    })
  }
}
