import type { AgentLaunchArtifactScope } from './AgentLaunchArtifactScope'
import { createAgentLaunchCleanupError } from './AgentLaunchCleanupError'

export async function rollbackAgentLaunchArtifacts(
  launchError: unknown,
  artifacts: AgentLaunchArtifactScope | undefined,
): Promise<never> {
  if (artifacts) {
    try {
      await artifacts.dispose()
    } catch (cleanupError) {
      throw createAgentLaunchCleanupError(
        launchError,
        cleanupError,
        'Agent launch and artifact cleanup both failed.',
      )
    }
  }
  throw launchError
}

export class AgentLaunchArtifactOwner {
  private readonly artifactsBySessionId = new Map<string, AgentLaunchArtifactScope>()
  private readonly pendingDisposals = new Set<Promise<void>>()

  public constructor(private readonly reportDisposalFailure: (error: unknown) => void) {}

  adopt(sessionId: string, artifacts: AgentLaunchArtifactScope | undefined): void {
    if (artifacts) {
      this.artifactsBySessionId.set(sessionId, artifacts)
    }
  }

  async rollbackFailedLaunch(
    launchError: unknown,
    artifacts: AgentLaunchArtifactScope | undefined,
  ): Promise<never> {
    return await rollbackAgentLaunchArtifacts(launchError, artifacts)
  }

  release(sessionId: string): void {
    const artifacts = this.artifactsBySessionId.get(sessionId)
    if (!artifacts) {
      return
    }
    this.artifactsBySessionId.delete(sessionId)
    const disposal = artifacts.dispose().catch(this.reportDisposalFailure)
    this.pendingDisposals.add(disposal)
    void disposal.then(() => this.pendingDisposals.delete(disposal))
  }

  releaseAll(): void {
    for (const sessionId of this.artifactsBySessionId.keys()) {
      this.release(sessionId)
    }
  }

  async drain(): Promise<void> {
    this.releaseAll()
    for (;;) {
      const pending = [...this.pendingDisposals]
      // New session exits may join the owner while a shutdown drain is in progress.
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(pending)
      if (this.pendingDisposals.size === 0) {
        return
      }
    }
  }
}
