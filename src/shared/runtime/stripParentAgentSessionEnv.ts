// These describe the launching Claude Code session, never user configuration. Keep this an
// exact list: other CLAUDE_CODE_* and ANTHROPIC_* variables configure the user's provider.
const PARENT_AGENT_SESSION_ENV_KEYS = [
  'CLAUDECODE', // Marks execution inside the parent Claude Code session (nested-session detection).
  'CLAUDE_CODE_CHILD_SESSION', // Marks a child of that session; suppresses its own transcript.
  'CLAUDE_CODE_ENTRYPOINT', // Identifies how the parent session was launched.
  'CLAUDE_CODE_EXECPATH', // Points to the executable running the parent session.
  'CLAUDE_CODE_MESSAGING_SOCKET', // Routes messages to the parent session's private socket.
  'CLAUDE_CODE_MESSAGING_TOKEN', // Authorizes messaging that parent session.
  'CLAUDE_CODE_SESSION_ATTENDED', // Describes whether that session is attended.
  'CLAUDE_CODE_SESSION_ID', // Identifies that session, not a new OpenCove-owned session.
  'CLAUDE_CODE_SSE_PORT', // Locates the parent session's SSE transport.
  'CLAUDE_PID', // Identifies the parent Claude process.
] as const

/** Mutates an owned environment; pass a copy when composing a child process environment. */
export function stripParentAgentSessionEnv(env: NodeJS.ProcessEnv): void {
  for (const key of PARENT_AGENT_SESSION_ENV_KEYS) {
    delete env[key]
  }
}
