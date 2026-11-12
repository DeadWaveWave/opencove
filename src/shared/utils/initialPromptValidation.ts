import { createAppError } from '../errors/appError'
import { terminalSpawnApplicationDescriptor } from '../errors/terminalSpawnErrorReasons'

/** Native argv uses NUL-terminated strings. Validate before normalization or launch effects. */
export function assertInitialPromptText(text: string): void {
  if (text.includes('\0')) {
    throw createAppError(terminalSpawnApplicationDescriptor('initial_prompt_contains_nul'))
  }
}
