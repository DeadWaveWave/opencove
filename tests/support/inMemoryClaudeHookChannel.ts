import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse, RequestListener, createServer } from 'node:http'
import { createCodexHookChannel } from '../../src/app/main/controlSurface/agentHook/codexHookChannel'
import { createClaudeHookChannel } from '../../src/app/main/controlSurface/agentHook/claudeHookChannel'

/** Real receiver/channel with only its network socket replaced; no local listen needed. */
export function inMemoryClaudeHookChannel() {
  return inMemoryHookChannel('claude')
}
export function inMemoryCodexHookChannel() {
  return inMemoryHookChannel('codex')
}
function inMemoryHookChannel(provider: 'claude' | 'codex') {
  let handler!: RequestListener
  const server = Object.assign(new EventEmitter(), {
    listening: false,
    listen(_port: number, _host: string, ready: () => void) {
      this.listening = true
      ready()
    },
    address: () => ({ port: 12345 }),
    close(done: () => void) {
      this.listening = false
      done()
    },
    closeAllConnections() {},
  })
  const channel = (provider === 'codex' ? createCodexHookChannel : createClaudeHookChannel)({
    createHttpServer: ((listener: RequestListener) => {
      handler = listener
      return server
    }) as typeof createServer,
  })
  return {
    channel,
    post: async (token: string, event: string, emitted?: string) => {
      const request = Object.assign(
        Readable.from([
          JSON.stringify(
            event === 'notify'
              ? { version: 1, state: 'done', hookEventName: 'notify', codexSessionId: provider }
              : {
                  hook_event_name: event,
                  session_id: provider,
                  cwd: '/tmp',
                  transcript_path: '/tmp/transcript.jsonl',
                },
          ),
        ]),
        {
          method: 'POST',
          url: `/hooks/${provider}`,
          setTimeout() {},
          headers: {
            'content-type': 'application/json',
            'x-opencove-hook-token': token,
            ...(emitted === undefined ? {} : { 'x-opencove-hook-emitted-at': emitted }),
          },
        },
      ) as unknown as IncomingMessage
      let status = 0
      await new Promise<void>(resolve => {
        const response = {
          get statusCode() {
            return status
          },
          set statusCode(value: number) {
            status = value
          },
          end: resolve,
        } as unknown as ServerResponse
        handler.call(server as never, request, response)
      })
      return status
    },
  }
}
