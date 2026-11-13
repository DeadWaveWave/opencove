import { createAppError } from '../errors/appError'
import { terminalSpawnApplicationDescriptor } from '../errors/terminalSpawnErrorReasons'
import { initialPromptRefusalDescriptor } from '../errors/initialPromptFeedback'

/** Native argv uses NUL-terminated strings. Validate before normalization or launch effects. */
export function assertInitialPromptText(text: string): void {
  if (text.includes('\0')) {
    throw createAppError(
      initialPromptRefusalDescriptor(
        terminalSpawnApplicationDescriptor('initial_prompt_contains_nul'),
        'nul',
        text,
      ),
    )
  }
}
