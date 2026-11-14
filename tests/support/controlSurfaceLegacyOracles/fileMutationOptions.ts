// @compat-file control-surface-legacy-validation
// Frozen from src/contexts/filesystem/domain/fileMutationOptions.ts at fff23113f96951bba8004b432539633f7e3c29e0.
import { createAppError } from '../../../src/shared/errors/appError'

export function optionalFileMutationBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid file mutation option.' })
}

/** Older Workers must reject strict semantics instead of silently ignoring their options. */
export const FILE_MUTATION_CAPABILITIES = {
  exclusiveWrite: true,
  nonRecursiveDelete: true,
} as const
