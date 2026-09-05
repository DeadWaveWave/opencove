export interface DiscoveredAgentSession {
  readonly resumeSessionId: string
  readonly filePath: string
}

/** Captured at watcher creation; an obsolete invocation must resolve to null. */
export interface AgentSessionDiscoveryHandle {
  resolve(): Promise<DiscoveredAgentSession | null>
  isCurrent(): boolean
}

export interface AgentSessionDiscovery {
  capture(sessionId: string): AgentSessionDiscoveryHandle | null
}
