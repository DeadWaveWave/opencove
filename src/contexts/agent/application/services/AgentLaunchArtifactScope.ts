import type { AgentRuntimeArtifact } from '../ports/AgentProviderContribution'

export interface AgentLaunchArtifactCleanupFailure {
  readonly error: unknown
  readonly label: string
}

export class AgentLaunchArtifactDisposalError extends AggregateError {
  readonly failures: readonly AgentLaunchArtifactCleanupFailure[]

  constructor(failures: readonly AgentLaunchArtifactCleanupFailure[]) {
    super(
      failures.map(failure => failure.error),
      'One or more Agent launch artifacts failed to dispose.',
    )
    this.name = 'AgentLaunchArtifactDisposalError'
    this.failures = failures
  }
}

interface TrackedAgentLaunchArtifact {
  readonly artifact: AgentRuntimeArtifact
  readonly label: string
}

export class AgentLaunchArtifactScope {
  private readonly artifactIdentities = new Set<AgentRuntimeArtifact>()
  private readonly artifacts: TrackedAgentLaunchArtifact[] = []
  private disposalPromise: Promise<void> | null = null
  private sealed = false

  get isDisposed(): boolean {
    return this.sealed && this.artifacts.length === 0
  }

  track<TArtifact extends AgentRuntimeArtifact>(label: string, artifact: TArtifact): TArtifact {
    if (this.sealed) {
      throw new Error('Agent launch artifact scope is already sealed.')
    }
    if (!label.trim()) {
      throw new Error('Agent launch artifact label cannot be empty.')
    }
    if (this.artifactIdentities.has(artifact)) {
      throw new Error('Agent launch artifact is already tracked by this scope.')
    }

    this.artifactIdentities.add(artifact)
    this.artifacts.push({ artifact, label })
    return artifact
  }

  seal(): void {
    this.sealed = true
  }

  dispose(): Promise<void> {
    this.seal()
    if (this.disposalPromise) {
      return this.disposalPromise
    }

    const disposal = this.disposeTrackedArtifacts()
    this.disposalPromise = disposal
    const clearDisposal = (): void => {
      if (this.disposalPromise === disposal) {
        this.disposalPromise = null
      }
    }
    void disposal.then(clearDisposal, clearDisposal)
    return disposal
  }

  private async disposeTrackedArtifacts(): Promise<void> {
    const failures: AgentLaunchArtifactCleanupFailure[] = []
    for (const entry of [...this.artifacts].reverse()) {
      try {
        // Artifact teardown is intentionally LIFO and sequential.
        // eslint-disable-next-line no-await-in-loop
        await entry.artifact.dispose()
        this.remove(entry)
      } catch (error) {
        failures.push({ error, label: entry.label })
      }
    }

    if (failures.length > 0) {
      throw new AgentLaunchArtifactDisposalError(failures)
    }
  }

  private remove(entry: TrackedAgentLaunchArtifact): void {
    const index = this.artifacts.indexOf(entry)
    if (index >= 0) {
      this.artifacts.splice(index, 1)
    }
    this.artifactIdentities.delete(entry.artifact)
  }
}
