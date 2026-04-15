import type { AgentProvider } from '@contexts/settings/domain/agentSettings'

export function resolveTerminalProviderHintFromCommand(command: string): AgentProvider | null {
  const normalizedCommand = command.trim()
  if (normalizedCommand.length === 0) {
    return null
  }

  const firstToken = normalizedCommand.split(/\s+/, 1)[0] ?? ''
  const unquotedToken = firstToken.replace(/^['"]+|['"]+$/g, '')
  const basename = unquotedToken.replace(/^.*[\\\\/]/, '')
  const executableName = basename.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '').toLowerCase()

  if (executableName === 'claude' || executableName === 'claude-code') {
    return 'claude-code'
  }

  if (executableName === 'codex') {
    return 'codex'
  }

  if (executableName === 'opencode') {
    return 'opencode'
  }

  if (executableName === 'gemini') {
    return 'gemini'
  }

  return null
}
