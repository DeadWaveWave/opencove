import WebSocket from 'ws'
import { defineCommand } from '../core/command'
import { CliError } from '../core/errors'
import { option } from './remote'
export const ptyAttach = defineCommand({
  path: ['pty', 'attach'],
  summary: 'Stream terminal output until exit or Ctrl-C',
  connect: true,
  stream: true,
  options: { session: option('Attach to this terminal session', 'id', true) },
  async execute({ connection, options, io }) {
    const url = new URL('/pty', connection!.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', connection!.token)
    if (io.signal?.aborted) {
      throw new CliError('cli.interrupted', 130, 'Detached')
    }
    const ws = new WebSocket(url, 'opencove-pty.v1')
    return new Promise<number>((done, reject) => {
      let settled = false
      const timer = setTimeout(
        () => finish(new CliError('transport.timeout', 124, 'PTY handshake timed out')),
        Number(options.timeout ?? 20000),
      )
      const abort = () => finish(undefined, 130)
      function finish(error?: Error, code = 0) {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        io.signal?.removeEventListener('abort', abort)
        ws.removeAllListeners('message')
        ws.terminate()
        if (error) {
          reject(error)
        } else {
          done(code)
        }
      }
      io.signal?.addEventListener('abort', abort, { once: true })
      ws.on('error', error => finish(error))
      ws.on('close', () =>
        finish(new CliError('pty.closed', 1, 'Terminal connection closed before process exit')),
      )
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            client: { kind: 'cli', version: null },
          }),
        ),
      )
      ws.on('message', raw => {
        let message
        try {
          message = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (!message || typeof message !== 'object') {
          return
        }
        if (message.type === 'hello_ack') {
          clearTimeout(timer)
          ws.send(
            JSON.stringify({ type: 'attach', sessionId: options.session, role: 'controller' }),
          )
        }
        if (message.type === 'data' && typeof message.data === 'string') {
          io.stdout.write(message.data)
        }
        if (message.type === 'exit') {
          finish(undefined, message.exitCode === 0 ? 0 : 1)
        }
        if (message.type === 'error') {
          finish(
            new CliError('pty.failed', 1, String(message.message ?? message.code ?? 'PTY error')),
          )
        }
      })
    })
  },
})
