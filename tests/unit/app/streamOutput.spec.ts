// @vitest-environment node
import { Writable } from 'node:stream'
import { expect, it } from 'vitest'
import { writeStreamRecord } from '../../../src/app/cli/core/streamOutput'
it('waits for the actual callback and drain, then releases listeners', async () => {
  let complete!: () => void
  const stream = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      complete = callback
    },
  })
  let done = false
  const writing = writeStreamRecord(stream, 'record\n', new AbortController().signal).then(() => {
    done = true
  })
  await Promise.resolve()
  expect(done).toBe(false)
  expect(stream.writableLength).toBeGreaterThan(0)
  complete()
  await writing
  expect(done).toBe(true)
  expect(stream.listenerCount('drain')).toBe(0)
})
it('cancels the underlying blocked write', async () => {
  const stream = new Writable({ write() {} })
  const controller = new AbortController()
  const writing = writeStreamRecord(stream, 'record\n', controller.signal)
  controller.abort(new Error('timeout'))
  await expect(writing).rejects.toThrow('timeout')
  expect(stream.destroyed).toBe(true)
})
it('propagates EPIPE without acknowledging a partial record', async () => {
  const stream = new Writable({
    write(_chunk, _encoding, cb) {
      cb(Object.assign(new Error('closed'), { code: 'EPIPE' }))
    },
  })
  // A real stdout retains its error observer for the process lifetime.
  stream.on('error', () => {})
  await expect(
    writeStreamRecord(stream, 'record\n', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'EPIPE' })
})
