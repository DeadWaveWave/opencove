import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
const socketState = vi.hoisted(() => ({ socket: null as unknown }))
vi.mock('ws', () => ({
  default: class extends EventEmitter {
    send = vi.fn()
    terminate = vi.fn()
    constructor() {
      super()
      socketState.socket = this
      queueMicrotask(() => this.emit('open'))
    }
  },
}))
function fixture() {
  let stdout = '',
    stderr = ''
  const controller = new AbortController()
  const io: CliIo = {
    stdout: {
      write: s => {
        stdout += s
      },
    },
    stderr: {
      write: s => {
        stderr += s
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'https://fixture', OPENCOVE_CONTROL_TOKEN: 'token' },
    fetch: vi.fn(),
    now: Date.now,
    readTextFile: vi.fn(),
    readStdinText: vi.fn(),
    signal: controller.signal,
  }
  return { io, controller, out: () => stdout, err: () => stderr }
}
it.each([0, 7])('streams raw output and maps remote exit %s', async code => {
  const f = fixture()
  const result = run(['pty', 'attach', '--session', 's'], f.io)
  await vi.waitFor(() => expect(socketState.socket).toBeTruthy())
  const socket = socketState.socket as EventEmitter & {
    send: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
  }
  socket.emit('message', Buffer.from('{"type":"hello_ack"}'))
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'attach', sessionId: 's', role: 'controller' }),
  )
  socket.emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'data', data: '\u001b[31m中文🙂\r\n' })),
  )
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'exit', exitCode: code })))
  expect(await result).toBe(code === 0 ? 0 : 1)
  expect(f.out()).toBe('\u001b[31m中文🙂\r\n')
  expect(f.err()).toBe('')
  expect(socket.terminate).toHaveBeenCalledOnce()
  expect(socket.listenerCount('message')).toBe(0)
  socketState.socket = null
})
it('Ctrl-C detaches during handshake with 130 and no JSON output', async () => {
  const f = fixture()
  const result = run(['pty', 'attach', '--session', 's'], f.io)
  await vi.waitFor(() => expect(socketState.socket).toBeTruthy())
  f.controller.abort()
  expect(await result).toBe(130)
  expect(f.out()).toBe('')
  expect(f.err()).toBe('')
  socketState.socket = null
})
