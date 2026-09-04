import { describe, expect, it } from 'vitest'
import { createSerialOperationQueue } from '@shared/runtime/serialOperationQueue'

describe('serial operation queue', () => {
  it('serializes operations and continues after rejection', async () => {
    const queue = createSerialOperationQueue()
    const events: string[] = []
    let release!: () => void
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })

    const first = queue.run(async () => {
      events.push('first:start')
      await blocked
      events.push('first:end')
      throw new Error('expected')
    })
    const second = queue.run(async () => {
      events.push('second')
      return 2
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    release()
    await expect(first).rejects.toThrow('expected')
    await expect(second).resolves.toBe(2)
    await queue.whenIdle()
    expect(events).toEqual(['first:start', 'first:end', 'second'])
  })
})
