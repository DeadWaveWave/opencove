import { createAppError } from '../../shared/errors/appError'
import { terminalSpawnApplicationDescriptor } from '../../shared/errors/terminalSpawnErrorReasons'

/** NUL terminates native environment entries/blocks; it must never become silent truncation. */
export function assertSpawnEnvironment(env: NodeJS.ProcessEnv): void {
  if (Object.entries(env).some(([key, value]) => key.includes('\0') || value?.includes('\0'))) {
    throw createAppError(terminalSpawnApplicationDescriptor('invalid_spawn_environment'))
  }
}
