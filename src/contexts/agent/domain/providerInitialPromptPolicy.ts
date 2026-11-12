import { CLAUDE_ROOT_COMMANDS } from './claudeRootCommands.generated'
import type { AgentProviderId } from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'
import { terminalSpawnApplicationDescriptor } from '../../../shared/errors/terminalSpawnErrorReasons'

// Generated from the pinned source registry, including hidden registrations and aliases.
const claudeCommands = new Set(CLAUDE_ROOT_COMMANDS)
const piCommands = new Set(['install', 'remove', 'uninstall', 'update', 'list', 'config'])

/** Pure preflight shared by UI and provider planners. Resume callers must omit initial text. */
export function assertProviderInitialPrompt(provider: AgentProviderId, text: string): void {
  const prompt = text.trim()
  const refused =
    provider === 'claude-code'
      ? prompt.startsWith('-') || claudeCommands.has(prompt)
      : provider === 'pi'
        ? prompt.startsWith('-') || prompt.startsWith('@') || piCommands.has(prompt)
        : false
  if (refused) {
    throw createAppError(terminalSpawnApplicationDescriptor('initial_prompt_unsupported'))
  }
}
