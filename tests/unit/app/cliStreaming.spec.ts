import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
const socketState = vi.hoisted(() => ({ socket: null as unknown, args: [] as unknown[] }))
vi.mock('ws', () => ({
  default: class extends EventEmitter {
    send = vi.fn()
    terminate = vi.fn()
    constructor(...args: unknown[]) {
      super()
      socketState.socket = this
      socketState.args = args
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
  expect(String(socketState.args[0])).toBe('wss://fixture/pty')
  expect(socketState.args[2]).toEqual({ headers: { authorization: 'Bearer token' } })
  socket.emit('message', Buffer.from('{"type":"hello_ack"}'))
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'attach', sessionId: 's', role: 'viewer' }),
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

it.each([401, 403, 503])(
  'classifies an HTTP %s handshake refusal and cleans up once',
  async statusCode => {
    const f = fixture()
    const removeAbort = vi.spyOn(f.io.signal!, 'removeEventListener')
    try {
      const result = run(['pty', 'attach', '--session', 's'], f.io)
      await vi.waitFor(() => expect(socketState.socket).toBeTruthy())
      const socket = socketState.socket as EventEmitter & { terminate: ReturnType<typeof vi.fn> }
      const response = { statusCode, destroy: vi.fn() }
      // Match ws: without an unexpected-response listener it emits a generic error instead.
      if (!socket.emit('unexpected-response', {}, response)) {
        socket.emit('error', new Error(`Unexpected server response: ${statusCode}`))
      }
      expect(await result).toBe(statusCode === 503 ? 1 : 4)
      expect(JSON.parse(f.err()).error).toMatchObject({
        code:
          statusCode === 401
            ? 'context.unauthorized'
            : statusCode === 403
              ? 'common.forbidden'
              : 'pty.handshake_failed',
        message:
          statusCode === 401
            ? 'The control token is invalid or has been revoked.'
            : statusCode === 403
              ? 'This credential does not permit the operation.'
              : 'Terminal connection was refused (HTTP 503).',
      })
      expect(response.destroy).toHaveBeenCalledOnce()
      expect(socket.terminate).toHaveBeenCalledOnce()
      expect(socket.listenerCount('message')).toBe(0)
      expect(socket.listenerCount('unexpected-response')).toBe(0)
      expect(socket.listenerCount('open')).toBe(0)
      expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
      const error = f.err()
      // terminate() can emit error/close after the refusal; neither may replace its outcome.
      socket.emit('error', new Error('WebSocket was closed before the connection was established'))
      socket.emit('close')
      f.controller.abort()
      expect(f.err()).toBe(error)
      expect(socket.terminate).toHaveBeenCalledOnce()
      expect(f.out()).toBe('')
    } finally {
      removeAbort.mockRestore()
      socketState.socket = null
    }
  },
)
