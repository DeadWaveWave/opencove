/** Runtime-owned identity observations, fenced to the current invocation before publication. */
export type AgentSessionIdentityObservation =
  | { identityAuthority: 'provider_session_start' | 'session_file'; resumeSessionId: string }
  | {
      identityAuthority: 'provider_session_snapshot'
      sequence: number
      resumeSessionId: string | null
    }
