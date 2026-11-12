import type { Connection } from './context'
import { CliError } from './errors'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface/protocol'

/** Fetch-based SSE keeps bearer authentication and cancellation in the CLI boundary. */
export async function* agentEvents(options: {
  connection: Connection
  nodeId?: string
  epoch: string
  afterSeq: number
  fetch: typeof fetch
  signal: AbortSignal
  onOpen?: () => Promise<void>
}): AsyncGenerator<unknown> {
  const url = new URL(`${options.connection.endpoint}/events`)
  for (const [key, value] of Object.entries({
    stream: 'agent',
    epoch: options.epoch,
    afterSeq: String(options.afterSeq),
    ...(options.nodeId ? { nodeId: options.nodeId } : {}),
    types: 'agent.state_changed,agent.turn_completed',
  })) {
    url.searchParams.set(key, value)
  }
  const response = await options.fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${options.connection.token}`,
      'x-opencove-protocol': String(CONTROL_SURFACE_PROTOCOL_VERSION),
      accept: 'text/event-stream',
    },
    signal: options.signal,
  })
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('text/event-stream') ||
    !response.body
  ) {
    await response.body?.cancel()
    throw new CliError(
      'agent.stream_failed',
      [401, 403].includes(response.status) ? 4 : 1,
      `Agent event stream refused (HTTP ${response.status}).`,
      'Check the connection and credentials; inspect with opencove agent get.',
    )
  }
  const reader = response.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) {
    abort()
  }
  const decoder = new TextDecoder()
  let buffer = '',
    data: string[] = [],
    pendingCr = false
  try {
    await options.onOpen?.()
    while (!options.signal.aborted) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read()
      if (chunk.done) {
        return
      }
      let text = decoder.decode(chunk.value, { stream: true })
      if (pendingCr && text.startsWith('\n')) {
        text = text.slice(1)
      }
      pendingCr = text.endsWith('\r')
      buffer += text.replace(/\r\n?/g, '\n')
      if (buffer.length + data.join('').length > 1024 * 1024) {
        throw new CliError(
          'agent.stream_invalid',
          5,
          'Agent event exceeded the client buffer limit.',
        )
      }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (!line && data.length) {
          const payload = data.join('\n')
          data = []
          try {
            yield JSON.parse(payload)
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new CliError('agent.stream_invalid', 5, 'Invalid JSON in agent event stream.')
            }
            throw error
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
    }
  } finally {
    options.signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
