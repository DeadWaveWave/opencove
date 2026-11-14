// @vitest-environment node
import { getEventListeners } from 'node:events'
import { PassThrough } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createNodeCliIo, type CliIo } from '../../../src/app/cli/core/io'
import { run } from '../../../src/app/cli/core/run'
import { runWithTargetFixtures as runPrompt } from './cliTargetFixtures.helpers'
import { promptUnknownRecovery } from '../../../src/shared/errors/agentPromptError'

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

it.each([false, true])(
  'preserves post-dispatch prompt recovery on Node SIGINT (TTY=%s)',
  async tty => {
    const sigintListeners = process.listenerCount('SIGINT')
    const { io: nodeIo } = adapter()
    nodeIo.env = { OPENCOVE_CONTROL_URL: 'http://fixture', OPENCOVE_CONTROL_TOKEN: 'test' }
    let diagnostic = ''
    nodeIo.stderr = {
      isTTY: tty,
      write(text) {
        diagnostic += text
      },
    }
    let markDispatched!: () => void
    const dispatched = new Promise<void>(done => {
      markDispatched = done
    })
    nodeIo.fetch = vi.fn(async (_url, init) => {
      expect(JSON.parse(String(init?.body)).id).toBe('agent.prompt')
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('Interrupted fetch')), {
          once: true,
        })
        markDispatched()
      })
    })
    const result = runPrompt(['agent', 'prompt', '--node', 'n', '--text', 'hello'], nodeIo)
    await dispatched
    process.emit('SIGINT')
    expect(await result).toBe(130)
    expect(diagnostic).toContain('The outcome is unknown.')
    expect(diagnostic).toContain('Do not resend.')
    expect(diagnostic).not.toContain('Nothing was sent')
    if (tty) {
      expect(diagnostic).toContain('delivery outcome: unknown.')
    } else {
      expect(JSON.parse(diagnostic.trim().split('\n').at(-1)!).error).toMatchObject({
        code: 'cli.interrupted',
        message: 'Prompt delivery was interrupted. The outcome is unknown.',
        hint: promptUnknownRecovery,
        details: { deliveryOutcome: 'unknown' },
      })
      expect(JSON.parse(diagnostic.trim().split('\n').at(-1)!).error.details).toEqual({
        deliveryOutcome: 'unknown',
      })
    }
    nodeIo.dispose?.()
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners)
  },
)
