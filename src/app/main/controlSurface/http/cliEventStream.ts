import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentRunStateRegistry } from '../../../../contexts/agent/application/AgentRunStateRegistry'
import type {
  ContextualPublication,
  RetainedEvent,
} from '../../../../contexts/agent/application/AgentRunSubscriptions'
import { matchesAgentRunFilter } from '../../../../contexts/agent/application/AgentRunStateEntry'
import { EventLineageReader } from '../../../../contexts/workspace/application/nodeLineage/EventLineageReader'
import type { NodeLineageRepository } from '../../../../contexts/workspace/application/nodeLineage/NodeLineageRepository'
import {
  canonicalSelection,
  decodeEventCursor,
  encodeEventCursor,
  eventRecordSchema,
  type EventRecord,
  type EventSelection,
} from '../../../../shared/contracts/dto/eventStream'
import { sendJson } from './httpJson'

export function serveCliEventStream(options: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  registry: AgentRunStateRegistry
  clients: Set<ServerResponse>
  listenerClients: Set<ServerResponse>
  isActive(): boolean
  readLineage(): Promise<NodeLineageRepository | undefined>
}): () => void {
  const { req, res, registry, url } = options
  let selection: EventSelection, cursor, resume: boolean
  try {
    const token = url.searchParams.get('after')
    const raw = url.searchParams.get('selection')
    if (!raw) {
      throw new Error('Missing selection')
    }
    selection = canonicalSelection(JSON.parse(raw))
    resume = token !== null
    cursor = token
      ? decodeEventCursor(token)
      : { version: 1 as const, ...registry.watermark(), selection }
    if (JSON.stringify(cursor.selection) !== JSON.stringify(selection)) {
      throw new Error('Cursor selection mismatch')
    }
  } catch {
    sendJson(res, 400, { error: 'Invalid event cursor or selection.' })
    return () => {}
  }
  let active = true,
    draining = false,
    bytes = 0,
    unsubscribe = () => {}
  let safeCursor = encodeEventCursor(cursor)
  const queue: { publication: ContextualPublication; size: number }[] = []
  let reader: EventLineageReader | undefined
  const dispose = () => {
    if (!active) {
      return
    }
    active = false
    unsubscribe()
    queue.length = 0
    bytes = 0
    reader?.dispose()
    options.clients.delete(res)
    options.listenerClients.delete(res)
    req.off('close', dispose)
    res.off('close', dispose)
    res.end()
  }
  const live = () => active && options.isActive() && !res.destroyed && !res.writableEnded
  const write = (record: EventRecord): boolean => {
    if (!live()) {
      dispose()
      return false
    }
    // No await between authority check and write. Node owns already submitted bytes.
    const text = `data: ${JSON.stringify(record)}\n\n`
    if (Buffer.byteLength(text) > 1024 * 1024) {
      dispose()
      return false
    }
    if (!res.write(text)) {
      dispose()
      return false
    }
    return true
  }
  const gap = (reason: Extract<EventRecord, { type: 'stream.gap' }>['reason'], oldestSeq = 0) => {
    write({
      version: 1,
      type: 'stream.gap',
      cursor: safeCursor,
      reason,
      current: registry.watermark(),
      oldestSeq,
    })
    dispose()
  }
  const spatial = (item: RetainedEvent) =>
    matchesAgentRunFilter(item, { ...selection, types: undefined })
  const relationship = Boolean(selection.spawnedBy || selection.lineage)
  const processItem = async (item: RetainedEvent) => {
    const previous = item.previousBinding
    const prior = previous
      ? {
          ...item,
          ...previous,
          event: { ...item.event, snapshot: { ...item.event.snapshot, nodeId: previous.nodeId } },
        }
      : undefined
    let currentMatch = spatial(item),
      previousMatch = prior ? spatial(prior) : false
    if (relationship && item.event.snapshot.nodeId === null) {
      currentMatch = false
    }
    if (relationship && previous?.nodeId === null) {
      previousMatch = false
    }
    let lineage = {
      spawnedBy: null as string | null,
      lineageDepth: null as number | null,
      lineageStatus: 'unavailable' as 'unavailable' | 'root' | 'recorded',
    }
    if (currentMatch || previousMatch) {
      try {
        if (!reader) {
          const repository = await options.readLineage()
          if (!live()) {
            return
          }
          if (!repository) {
            throw new Error('Lineage unavailable')
          }
          reader = new EventLineageReader(repository)
        }
        if (relationship) {
          currentMatch =
            currentMatch && (await reader.matches(item.event.snapshot.nodeId, selection))
          previousMatch = previousMatch && (await reader.matches(previous!.nodeId, selection))
        }
        if (currentMatch) {
          lineage = { ...lineage, ...(await reader.project(item.event.snapshot.nodeId)) }
        }
      } catch {
        if (relationship) {
          gap('filter_unavailable')
          return
        }
      }
    }
    if (!live()) {
      return
    }
    if (previousMatch && !currentMatch) {
      gap('binding_changed')
      return
    }
    if (!currentMatch || !selection.types.includes(item.event.type)) {
      return
    }
    const token = encodeEventCursor({
      version: 1,
      epoch: item.event.epoch,
      seq: item.event.seq,
      selection,
    })
    if (
      write(
        eventRecordSchema.parse({
          version: 1,
          ...item.event,
          cursor: token,
          projectId: item.projectId ?? null,
          spaceId: item.spaceId ?? null,
          ...lineage,
        }),
      )
    ) {
      safeCursor = token
    }
  }
  const drain = async () => {
    if (draining) {
      return
    }
    draining = true
    try {
      while (live() && queue.length) {
        const next = queue.shift()!
        // Serialize enrichment to preserve publication order.
        if ('event' in next.publication) {
          // eslint-disable-next-line no-await-in-loop
          await processItem(next.publication)
        } else {
          gap(next.publication.reason, next.publication.oldestSeq)
        }
        // Includes the in-flight publication in the byte/count budget.
        if (active) {
          bytes -= next.size
        }
      }
    } catch {
      gap('filter_unavailable')
    } finally {
      draining = false
    }
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  })
  options.clients.add(res)
  options.listenerClients.add(res)
  req.once('close', dispose)
  res.once('close', dispose)
  if (
    !write({
      version: 1,
      type: 'stream.ready',
      cursor: safeCursor,
      selection,
      mode: resume ? 'resume' : 'live',
    })
  ) {
    return dispose
  }
  // Watermark capture, ready and registration are synchronous: no publication can slip between them.
  unsubscribe = registry.subscribeContextual(
    { epoch: cursor.epoch, afterSeq: cursor.seq },
    publication => {
      if (!live()) {
        dispose()
        return
      }
      const size = Buffer.byteLength(JSON.stringify(publication))
      if (queue.length + Number(draining) >= 1024 || bytes + size > 1024 * 1024) {
        gap('queue_overflow')
        return
      }
      bytes += size
      queue.push({ publication, size })
      void drain()
    },
  )
  if (!active) {
    unsubscribe()
  }
  return dispose
}
