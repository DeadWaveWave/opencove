/** Accepted provider facts, not file-discovery guesses or process-exit notifications. */
export type AgentSessionIdentityObservation =
  | { identityAuthority: 'provider_session_start'; resumeSessionId: string }
  | {
      identityAuthority: 'provider_session_snapshot'
      sequence: number
      resumeSessionId: string | null
    }
