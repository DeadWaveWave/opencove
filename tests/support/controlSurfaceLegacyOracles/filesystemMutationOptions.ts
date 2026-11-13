// @compat-file control-surface-legacy-validation
// Frozen from src/contexts/filesystem/domain/fileMutationOptions.ts at 6df96903c64d6fb3c541c79815713996d3c1b186
import { createAppError } from '../../../src/shared/errors/appError'

export function optionalFileMutationBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid file mutation option.' })
}
