import { sseFrames } from './sseFrames'
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
  yield* sseFrames(response.body, options.signal, options.onOpen)
}
