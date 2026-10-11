export interface PluginTargetInput {
  projectId: string
  spaceId?: string
}

export interface PluginResolvedTarget {
  projectId: string
  spaceId: string | null
  mountId: string
  endpointId: string
  rootUri: string
  cwdUri: string
  workingDirectory: string
}

export interface PluginOperationSnapshot {
  operationId: string
  status: 'starting' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
  target: PluginResolvedTarget
  output: string
  truncated: boolean
  exitCode: number | null
  error: string | null
}

/** Authority is supplied by the host; it is never read from plugin payloads. */
export interface PluginHostAuthority {
  pluginId: string
  ownerId: string
  assertActive(): void
}

export interface PluginHostPort {
  request(authority: PluginHostAuthority, operation: string, payload: unknown): Promise<unknown>
  retire(ownerId: string): Promise<void>
}
