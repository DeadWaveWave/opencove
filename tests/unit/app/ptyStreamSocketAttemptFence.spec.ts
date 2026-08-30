import { describe, expect, it } from 'vitest'
import { PtyStreamSocketAttemptFence } from '../../../src/shared/runtime/ptyStreamSocketAttemptFence'

describe('PTY stream socket attempt fence', () => {
  it('prevents a pre-socket continuation from superseding a replacement attempt', () => {
    const fence = new PtyStreamSocketAttemptFence()
    const retired = fence.begin()
    fence.retire()
    const replacement = fence.begin()

    expect(() => fence.assertCurrent(retired)).toThrow('retired')
    expect(() => fence.assertCurrent(replacement)).not.toThrow()
  })
})
