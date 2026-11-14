import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentProviderInitialPromptPolicy,
} from '../contracts/agentProviderDescriptors'
import { assertInitialPromptText } from './initialPromptValidation'
import type { AgentProviderId } from '../contracts/dto'
import { createAppError } from '../errors/appError'
import { terminalSpawnApplicationDescriptor } from '../errors/terminalSpawnErrorReasons'
import { initialPromptRefusalDescriptor } from '../errors/initialPromptFeedback'

/** Pure preflight shared by UI and provider planners. Resume callers must omit initial text. */
export function assertProviderInitialPrompt(provider: AgentProviderId, text: string): void {
  assertInitialPromptText(text)
  const prompt = text.trim()
  const policy: AgentProviderInitialPromptPolicy =
    AGENT_PROVIDER_DESCRIPTORS[provider].initialPrompt
  const refused =
    policy.refusedPrefixes.some(prefix => prompt.startsWith(prefix)) ||
    policy.refusedCommands.includes(prompt)
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
