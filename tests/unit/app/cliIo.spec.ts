// @vitest-environment node
import { getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createNodeCliIo, type CliIo } from '../../../src/app/cli/core/io'
import { run } from '../../../src/app/cli/core/run'

let io: CliIo | undefined
let stdin: PassThrough | undefined
afterEach(() => {
  io?.dispose?.()
  stdin?.destroy()
  vi.restoreAllMocks()
})
function adapter() {
  stdin = new PassThrough()
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as typeof process.stdin)
  io = createNodeCliIo()
  io.stdout = { write: vi.fn() }
  io.stderr = { write: vi.fn() }
  io.fetch = vi.fn()
  io.readTextFile = vi.fn()
  return { io, stdin }
}
function expectReadCleaned(input: PassThrough, signal: AbortSignal) {
  for (const event of ['data', 'end', 'error', 'close']) {
    expect(input.listenerCount(event), event).toBe(0)
  }
  expect(getEventListeners(signal, 'abort')).toHaveLength(0)
}
it.each(['中文🙂', '{"text":"中文🙂"}'])('decodes UTF-8 split at every byte: %s', async text => {
  const { io: nodeIo, stdin: input } = adapter()
  const result = nodeIo.readStdinText()
  for (const byte of Buffer.from(text)) {
    input.write(Buffer.from([byte]))
    // Force a separate read chunk instead of letting the stream coalesce writes.
    // eslint-disable-next-line no-await-in-loop
    await nextTurn()
  }
  input.end()
  await expect(result).resolves.toBe(text)
  expectReadCleaned(input, nodeIo.signal!)
})
it.each([
  ['node', 'create', 'note', '--space', 's', '--text-file', '-'],
  ['api', 'call', 'node.delete', '--input-file', '-'],
])('interrupts pending stdin and returns 130: %j', async (...argv) => {
  const sigintListeners = process.listenerCount('SIGINT')
  const { io: nodeIo, stdin: input } = adapter()
  const reading = new Promise<void>(resolve => input.once('resume', resolve))
  const result = run(argv, nodeIo)
  await reading
  expect(input.readableEnded).toBe(false)
  process.emit('SIGINT')
  await expect(result).resolves.toBe(130)
  expect(nodeIo.stdout.write).not.toHaveBeenCalled()
  expect(nodeIo.stderr.write).toHaveBeenCalledWith(expect.stringContaining('cli.interrupted'))
  expect(nodeIo.fetch).not.toHaveBeenCalled()
  expect(nodeIo.readTextFile).not.toHaveBeenCalled()
  expect(input.isPaused()).toBe(true)
  expectReadCleaned(input, nodeIo.signal!)
  nodeIo.dispose?.()
  expect(process.listenerCount('SIGINT')).toBe(sigintListeners)
})
it('rejects stdin reads after interruption without installing listeners', async () => {
  const { io: nodeIo, stdin: input } = adapter()
  process.emit('SIGINT')
  await expect(nodeIo.readStdinText()).rejects.toMatchObject({
    code: 'cli.interrupted',
    exitCode: 130,
  })
  expectReadCleaned(input, nodeIo.signal!)
})
it('cleans listeners when stdin fails', async () => {
  const { io: nodeIo, stdin: input } = adapter()
  const result = nodeIo.readStdinText()
  input.emit('error', new Error('read failure'))
  await expect(result).rejects.toThrow('read failure')
  expectReadCleaned(input, nodeIo.signal!)
})
