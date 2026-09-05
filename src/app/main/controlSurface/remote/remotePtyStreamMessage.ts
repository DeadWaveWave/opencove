export type PtyStreamMessage =
  | { type: 'hello_ack'; protocolVersion: number; capabilities?: unknown }
  | { type: 'attached'; sessionId: string; seq?: number; role?: string; authorityEpoch?: number }
  | { type: 'data'; sessionId: string; seq?: number; data?: string }
  | { type: 'exit'; sessionId: string; seq?: number; exitCode?: number }
  | ({ type: 'foreground' } & Record<string, unknown>)
  | {
      type: 'geometry'
      sessionId: string
      cols?: number
      rows?: number
      reason?: string
      revision?: number
    }
  | {
      type: 'state'
      sessionId: string
      state?: string
      piConversation?: unknown
      observationUnavailable?: unknown
      source?: string
      hookInstallState?: string
      degraded?: boolean
      observedAtMs?: number
    }
  | {
      type: 'metadata'
      sessionId: string
      resumeSessionId?: string | null
      agentProvider?: string | null
      profileId?: string | null
      runtimeKind?: string | null
      terminalAgentActivity?: unknown
      piSnapshot?: unknown
    }
  | {
      type: 'overflow'
      sessionId: string
      seq?: number
      reason?: string
      recovery?: string
    }
  | { type: 'control_changed'; sessionId: string; role?: string; authorityEpoch?: number }
  | ({ type: 'resize_result' } & Record<string, unknown>)
  | ({ type: 'agent_reexec_result' } & Record<string, unknown>)
  | { type: 'error'; code?: string; message?: string; sessionId?: string }
