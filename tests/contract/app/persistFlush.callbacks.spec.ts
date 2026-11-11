import { expect, it, vi } from 'vitest'
import { createPersistFlushSubscription } from '@app/preload/persistFlushSubscription'
it('sends one ACK only after all callbacks settle and removes unsubscribed listeners', async () => {
  let handler!: (_event: unknown, payload: { requestId: string }) => void
  const send = vi.fn(),
    removeListener = vi.fn()
  const on = vi.fn((_channel, callback) => {
    handler = callback
  })
  const subscribe = createPersistFlushSubscription({ on, send, removeListener })
  let resolveFirst!: () => void, rejectSecond!: () => void
  const first = vi.fn(
    () =>
      new Promise<void>(resolve => {
        resolveFirst = resolve
      }),
  )
  const second = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSecond = reject
      }),
  )
  const stopFirst = subscribe(first),
    stopSecond = subscribe(second)
  handler({}, { requestId: 'one' })
  await Promise.resolve()
  resolveFirst()
  await Promise.resolve()
  await Promise.resolve()
  expect(send).not.toHaveBeenCalled()
  rejectSecond(new Error('failed'))
  await vi.waitFor(() =>
    expect(send).toHaveBeenCalledExactlyOnceWith('app:persist-flush-complete', {
      requestId: 'one',
    }),
  )
  stopSecond()
  handler({}, { requestId: 'two' })
  await Promise.resolve()
  resolveFirst()
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(second).toHaveBeenCalledTimes(1)
  expect(first).toHaveBeenCalledTimes(2)
  stopFirst()
  expect(removeListener).toHaveBeenCalledTimes(1)
  expect(on).toHaveBeenCalledTimes(1)
})
