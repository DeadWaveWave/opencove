import type { PersistWriteResult } from './types'
import { persistenceScope, beginPublicationSubmission } from './publicationState'
import { createAppErrorDescriptor } from '@shared/errors/appError'

let owner = -1
let tail: Promise<void> | null = null

/** All renderer publications share one critical section, including receipt consumption. */
export function enqueuePublication(
  run: () => Promise<PersistWriteResult>,
): Promise<PersistWriteResult> {
  const generation = persistenceScope()
  if (owner !== generation) {
    owner = generation
    tail = null
  }
  const execute = async (): Promise<PersistWriteResult> => {
    if (generation !== persistenceScope()) {
      return {
        ok: false,
        reason: 'unavailable',
        outcome: 'notSubmitted',
        error: createAppErrorDescriptor('persistence.unavailable'),
      }
    }
    // Refresh must also wait through preparatory reads and receipt consumption.
    const finish = beginPublicationSubmission()
    try {
      return await run()
    } finally {
      finish()
    }
  }
  const result = tail ? tail.then(execute) : execute()
  const completion = result.then(
    () => {},
    () => {},
  )
  tail = completion
  void completion.then(() => {
    if (tail === completion) {
      tail = null
    }
  })
  return result
}
