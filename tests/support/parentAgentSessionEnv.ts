// Deliberately independent of the production list: catch missing or overbroad filtering.
export const parentAgentSessionEnv = {
  CLAUDECODE: '1',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_EXECPATH: '/parent/claude',
  CLAUDE_CODE_MESSAGING_SOCKET: '/parent/messaging.sock',
  CLAUDE_CODE_MESSAGING_TOKEN: 'test-parent-session-token',
  CLAUDE_CODE_SESSION_ATTENDED: '1',
  CLAUDE_CODE_SESSION_ID: 'test-parent-session',
  CLAUDE_CODE_SSE_PORT: '12345',
  CLAUDE_PID: '1234',
}

export const agentConfigurationEnv = {
  PATH: '/usr/bin',
  CLAUDE_CODE_USE_BEDROCK: '1',
  CLAUDE_CODE_USE_VERTEX: '1',
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192',
  CLAUDE_CODE_FUTURE_OPTION: 'keep-unknown-options',
  CLAUDE_CODE_SESSION_ID_SUFFIX: 'keep-prefix-lookalikes',
  ANTHROPIC_BASE_URL: 'https://example.test/anthropic',
  ANTHROPIC_API_KEY: 'test-user-api-key',
  CLAUDE_CONFIG_DIR: '/test/claude-config',
  OPENCOVE_CLAUDE_HOOK_TOKEN: 'test-opencove-hook-token',
  EMPTY_VALUE: '',
  UNDEFINED_VALUE: undefined,
}
