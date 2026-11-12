import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse, Server, RequestListener } from 'node:http'
import { createServer } from 'node:http'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'

/** Runs the actual authenticated hook handler without opening a socket. */
export async function hookChannelFixture(options?: {
  environment?: Readonly<NodeJS.ProcessEnv>
  residentContext?: 'canvas' | 'none'
}) {
  let receive!: RequestListener
  const server = Object.assign(new EventEmitter(), {
    listening: false,
    listen(_port: number, _host: string, ready: () => void) {
      this.listening = true
      ready()
    },
    address: () => ({ port: 10000, family: 'IPv4', address: '127.0.0.1' }),
    close(done: () => void) {
      this.listening = false
      done()
    },
    closeAllConnections() {},
  })
  const createHttpServer = ((listener: RequestListener) => {
    receive = listener
    return server as unknown as Server
  }) as typeof createServer
  const channel = createClaudeHookChannel({ createHttpServer })
  const reservation = await channel.reserveSpawn(options)
  const responses: string[] = []
  const post = async (payload: unknown, emittedAtMs?: number) =>
    await new Promise<number>(resolve => {
      const request = Object.assign(new EventEmitter(), {
        method: 'POST',
        url: '/hooks/claude',
        headers: {
          'content-type': 'application/json',
          ...(emittedAtMs === undefined
            ? {}
            : { 'x-opencove-hook-emitted-at': String(emittedAtMs) }),
          'x-opencove-hook-token': reservation.env!.OPENCOVE_CLAUDE_HOOK_TOKEN,
        },
        setTimeout() {
          return this
        },
        destroy() {
          return this
        },
      }) as unknown as IncomingMessage
      const response = {
        statusCode: 0,
        setHeader() {},
        end(body?: string) {
          if (body) {
            responses.push(body)
          }
          resolve(this.statusCode)
        },
      } as unknown as ServerResponse
      receive(request, response)
      request.emit('data', Buffer.from(JSON.stringify(payload)))
      request.emit('end')
    })
  return { channel, reservation, post, responses }
}
