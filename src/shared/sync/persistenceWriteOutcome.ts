import type { PersistWriteResult } from '../contracts/dto/persistence'
import { OpenCoveAppError, isAppErrorDescriptor, toAppErrorDescriptor } from '../errors/appError'
export type WriteFailure = Extract<PersistWriteResult, { ok: false }>
/** Preserve the submission boundary even when an adapter performs preparatory reads. */
class SubmissionError extends OpenCoveAppError {
  readonly failure: WriteFailure
  readonly original: unknown
  constructor(error: unknown) {
    const failure = persistenceWriteFailure(error, 'unknown')
    super(failure.error)
    this.failure = failure
    this.original = error
    if (error instanceof Error) {
      this.message = error.message
    }
  }
}
export async function submitPersistenceWrite<T>(submit: () => Promise<T>): Promise<T> {
  try {
    return await submit()
  } catch (error) {
    throw new SubmissionError(error)
  }
}
export function persistenceWriteFailure(
  error: unknown,
  fallback: 'unknown' | 'notSubmitted' = 'unknown',
): WriteFailure {
  if (error instanceof SubmissionError) {
    return error.failure
  }
  const descriptor = toAppErrorDescriptor(error, 'persistence.io_failed')
  // Only explicit validation/authority rejections prove that a write did not commit.
  // Error identity, unexpected failures and launch uncertainty do not establish that fact.
  const rejected =
    (isAppErrorDescriptor(error) || error instanceof OpenCoveAppError) &&
    [
      'common.invalid_input',
      'common.forbidden',
      'common.approved_path_required',
      'common.protocol_incompatible',
      'control_surface.unauthorized',
      'persistence.invalid_state',
      'persistence.invalid_node_id',
      'persistence.owned_node_identity_conflict',
      'persistence.quota_exceeded',
      'persistence.payload_too_large',
    ].includes(descriptor.code)
  return { ok: false, reason: 'io', error: descriptor, outcome: rejected ? 'rejected' : fallback }
}
export function classifyWriteResult(result: PersistWriteResult): PersistWriteResult {
  if (result.ok || result.outcome) {
    return result
  }
  return {
    ...result,
    // SQLite's validation rejection predates outcome and uses the legacy reason "unknown".
    // The authoritative error code wins over that transport-agnostic legacy field.
    outcome:
      result.error.code !== 'persistence.io_failed' &&
      result.error.code !== 'persistence.unavailable'
        ? 'rejected'
        : result.reason === 'io' ||
            /* @compat remote-persistence-legacy-outcome */ result.reason === 'unknown'
          ? 'unknown'
          : 'rejected',
  }
}

export function originalSubmissionError(error: unknown): unknown {
  return error instanceof SubmissionError ? error.original : error
}
