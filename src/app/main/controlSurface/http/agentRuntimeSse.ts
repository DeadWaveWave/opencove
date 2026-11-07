import type { IncomingMessage, ServerResponse } from 'node:http'
import * as z from 'zod'
import type { AgentRunStateRegistry } from '../../../../contexts/agent/application/AgentRunStateRegistry'
import { sendJson } from './httpJson'

const querySchema = z.object({
  epoch: z.string().min(1).optional(),
  afterSeq: z.string().regex(/^\d+$/).optional(),
  types: z.array(z.enum(['agent.state_changed', 'agent.turn_completed'])).optional(),
  nodeId: z.string().min(1).optional(),
  spaceId: z.string().min(1).optional(),
})
export function isAgentRuntimeStream(url: URL): boolean {
  return (
    url.searchParams.get('stream') === 'agent' ||
    url.searchParams.has('afterSeq') ||
    url.searchParams.has('epoch') ||
    (url.searchParams.get('types') ?? '').includes('agent.')
  )
}

export function serveAgentRuntimeEvents(options: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  registry: AgentRunStateRegistry
  clients: Set<ServerResponse>
  listenerClients: Set<ServerResponse>
}): void {
  const { req, res, registry, url } = options
  const parsed = querySchema.safeParse({
    ...Object.fromEntries(
      ['epoch', 'afterSeq', 'nodeId', 'spaceId'].flatMap(key =>
        url.searchParams.has(key) ? [[key, url.searchParams.get(key)]] : [],
      ),
    ),
    ...(url.searchParams.has('types') ? { types: url.searchParams.get('types')!.split(',') } : {}),
  })
  if (
    !parsed.success ||
    (parsed.data.afterSeq !== undefined && !Number.isSafeInteger(Number(parsed.data.afterSeq)))
  ) {
    sendJson(res, 400, { error: 'Invalid agent event cursor or filter' })
    return
  }
  const input = parsed.data
  const watermark = registry.list()
  // afterSeq alone cannot establish which Worker issued it: fail closed with resync.
  const cursor = {
    epoch: input.epoch ?? (input.afterSeq === undefined ? watermark.epoch : ''),
    afterSeq: input.afterSeq === undefined ? watermark.seq : Number(input.afterSeq),
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(':\n\n')
  options.clients.add(res)
  options.listenerClients.add(res)
  let unsubscribe = () => {}
  const cleanup = () => {
    unsubscribe()
    options.clients.delete(res)
    options.listenerClients.delete(res)
  }
  req.once('close', cleanup)
  res.once('close', cleanup)
  unsubscribe = registry.subscribe(cursor, input, event => {
    if (res.destroyed) {
      return
    }
    const accepted = res.write(
      `event: ${event.type}\nid: ${event.epoch}:${event.seq}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    if (event.type === 'resync_required') {
      res.end()
    } else if (!accepted) {
      res.destroy()
    }
  })
  if (res.destroyed || res.writableEnded) {
    cleanup()
  }
}
