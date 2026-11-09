import {
  publicTerminalSpawnApplicationError,
  terminalSpawnApplicationDescriptor,
  type TerminalSpawnApplicationReason,
} from './terminalSpawnErrorReasons'
import type { AppErrorCode } from '../contracts/dto'
import { createAppError, toAppErrorDescriptor } from './appError'
import { SessionRegistrationRejectedError } from '../runtime/sessionRegistrationOwner'

export { publicTerminalSpawnApplicationError } from './terminalSpawnErrorReasons'

export function createTerminalSpawnApplicationError(reason: TerminalSpawnApplicationReason) {
  return createAppError(terminalSpawnApplicationDescriptor(reason))
}

/** Expose error codes and fixed lifecycle text, never private process argv/env from errors. */
export function publicTerminalSpawnError(error: unknown, fallback: AppErrorCode) {
  const application = publicTerminalSpawnApplicationError(error)
  if (application) {
    return createAppError(application)
  }
  const debugMessage =
    error instanceof SessionRegistrationRejectedError
      ? error.disposition === 'completed'
        ? 'The session completed before spawn registration.'
        : 'The session lost its owner before spawn registration.'
      : undefined
  return createAppError(toAppErrorDescriptor(error, fallback).code, { debugMessage })
}
