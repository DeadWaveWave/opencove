export interface DiscoveredAgentSession {
  readonly resumeSessionId: string
  readonly filePath: string
}

/** Discovery baseline passed from launch orchestration to the session-file watcher. */
export interface GeminiSessionDiscoveryCursor {
  entriesByFilePath: Record<string, { signature: string; hadRelevantTurn: boolean }>
}

/** Captured at watcher creation; an obsolete invocation must resolve to null. */
export interface AgentSessionDiscoveryHandle {
  resolve(): Promise<DiscoveredAgentSession | null>
  isCurrent(): boolean
}

export interface AgentSessionDiscovery {
  capture(sessionId: string): AgentSessionDiscoveryHandle | null
}
