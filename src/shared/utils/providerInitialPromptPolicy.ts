import { CLAUDE_ROOT_COMMANDS } from './claudeRootCommands.generated'
import { assertInitialPromptText } from './initialPromptValidation'
import type { AgentProviderId } from '../contracts/dto'
import { createAppError } from '../errors/appError'
import { terminalSpawnApplicationDescriptor } from '../errors/terminalSpawnErrorReasons'
import { initialPromptRefusalDescriptor } from '../errors/initialPromptFeedback'

// Generated from the pinned source registry, including hidden registrations and aliases.
const claudeCommands = new Set(CLAUDE_ROOT_COMMANDS)
const piCommands = new Set(['install', 'remove', 'uninstall', 'update', 'list', 'config'])

/** Pure preflight shared by UI and provider planners. Resume callers must omit initial text. */
export function assertProviderInitialPrompt(provider: AgentProviderId, text: string): void {
  assertInitialPromptText(text)
  const prompt = text.trim()
  const refused =
    provider === 'claude-code'
      ? prompt.startsWith('-') || claudeCommands.has(prompt)
      : provider === 'pi'
        ? prompt.startsWith('-') || prompt.startsWith('@') || piCommands.has(prompt)
        : false
  if (refused) {
    const kind = prompt.startsWith('-')
      ? 'leading_dash'
      : prompt.startsWith('@')
        ? 'unverified_file_reference'
        : 'command_token'
    throw createAppError(
      initialPromptRefusalDescriptor(
        terminalSpawnApplicationDescriptor('initial_prompt_unsupported'),
        kind,
        prompt,
      ),
    )
  }
}
