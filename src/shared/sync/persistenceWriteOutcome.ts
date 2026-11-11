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
  const rejected =
    (isAppErrorDescriptor(error) || error instanceof OpenCoveAppError) &&
    descriptor.code !== 'persistence.io_failed' &&
    descriptor.code !== 'persistence.unavailable'
  return { ok: false, reason: 'io', error: descriptor, outcome: rejected ? 'rejected' : fallback }
}
export function classifyWriteResult(result: PersistWriteResult): PersistWriteResult {
  if (result.ok || result.outcome) {
    return result
  }
  return {
    ...result,
    outcome:
      result.reason === 'io' || result.reason === 'unknown'
        ? result.reason === 'unknown' || result.error.code === 'persistence.io_failed'
          ? 'unknown'
          : 'rejected'
        : 'rejected',
  }
}

export function originalSubmissionError(error: unknown): unknown {
  return error instanceof SubmissionError ? error.original : error
}
