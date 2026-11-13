import { loadEventCheckpoint, saveEventCheckpoint } from './eventCheckpoint'
import { resolveEventSelection } from './eventSelection'
import { eachTurnCompletion } from './eventTurnCompletion'
import { abortable } from './streamLifetime'
import type { CommandContext } from './command'
import { CliError } from './errors'
import {
  decodeEventCursor,
  eventRecordSchema,
  type EventRecord,
} from '../../../shared/contracts/dto/eventStream'
import { sseFrames } from './sseFrames'
import { project } from './projection'

export async function runEvents(ctx: CommandContext): Promise<number> {
  const { io, options } = ctx
  await loadEventCheckpoint(ctx)
  const capabilities = (await ctx.invoke('system.capabilities', {})) as {
    features?: { eventStreamV1?: boolean; nodeLineageV1?: boolean }
  }
  if (!capabilities.features?.eventStreamV1) {
    throw new CliError(
      'events.unsupported',
      5,
      'This Worker does not support resumable event streams.',
      'Update and restart the Worker, then try again.',
    )
  }
  const selection = await resolveEventSelection(ctx)
  if ((selection.lineage || selection.spawnedBy) && !capabilities.features.nodeLineageV1) {
    throw new CliError(
      'events.unsupported',
      5,
      'This Worker does not support creation lineage filters.',
      'Update and restart the Worker, then try again.',
    )
  }
  const eachTurn = eachTurnCompletion(ctx)
  const controller = new AbortController()
  const abort = () => controller.abort(io.signal?.reason)
  io.signal?.addEventListener('abort', abort, { once: true })
  if (io.signal?.aborted) {
    abort()
  }
  let opened = false
  const timer = setTimeout(
    () =>
      controller.abort(
        new CliError(
          opened ? 'events.protocol_incompatible' : 'events.connection_unavailable',
          opened ? 5 : 3,
          opened
            ? 'The Worker did not establish a v1 event stream in time.'
            : 'The Worker did not respond to the event connection in time.',
          'Update and restart the Worker.',
        ),
      ),
    5000,
  )
  const signal = controller.signal
  let lastCursor: string | undefined = options.after as string | undefined
  let position = lastCursor ? decodeEventCursor(lastCursor) : undefined
  let ready = false,
    count = 0
  const write = async (record: EventRecord) => {
    const value =
      record.type.startsWith('agent.') && options.fields !== undefined
        ? project(
            record,
            [
              ...new Set([
                'version',
                'type',
                'cursor',
                ...String(options.fields)
                  .split(',')
                  .map(f => f.trim()),
              ]),
            ].map(f => f.split('.')),
          )
        : record
    const text = JSON.stringify(value) + '\n'
    try {
      if (io.writeRecord) {
        await abortable(io.writeRecord(text, signal), signal)
      } else {
        const result = io.stdout.write(text)
        if (result === false) {
          throw new Error('Output writer does not support backpressure.')
        }
        await result
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EPIPE' || signal.aborted) {
        throw error
      }
      throw new CliError(
        'events.output_failed',
        1,
        'Unable to finish writing an event record.',
        'Only complete newline-terminated records can be resumed.',
        { cursor: lastCursor },
      )
    }
    await saveEventCheckpoint(options['cursor-file'], record.cursor)
    signal.throwIfAborted()
  }
  try {
    const url = new URL(`${ctx.connection!.endpoint}/events`)
    url.searchParams.set('stream', 'agent')
    url.searchParams.set('format', 'cli-v1')
    url.searchParams.set('selection', JSON.stringify(selection))
    if (lastCursor) {
      url.searchParams.set('after', lastCursor)
    }
    const response = await abortable(
      io.fetch(url.toString(), {
        signal,
        headers: { authorization: `Bearer ${ctx.connection!.token}`, accept: 'text/event-stream' },
      }),
      signal,
    )
    opened = true
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('content-type')?.startsWith('text/event-stream')
    ) {
      await response.body?.cancel()
      throw new CliError(
        'events.connection_failed',
        [401, 403].includes(response.status)
          ? 4
          : response.status === 400
            ? 2
            : response.ok
              ? 5
              : 3,
        `Event stream refused (HTTP ${response.status}).`,
      )
    }
    for await (const raw of sseFrames(response.body, signal)) {
      const parsed = eventRecordSchema.safeParse(raw)
      if (!parsed.success) {
        throw new CliError(
          'events.protocol_incompatible',
          5,
          'The Worker returned an incompatible event record.',
          'Update and restart the Worker.',
        )
      }
      const record = parsed.data
      let token
      try {
        token = decodeEventCursor(record.cursor)
      } catch {
        throw new CliError(
          'events.protocol_incompatible',
          5,
          'The Worker returned an invalid event cursor.',
        )
      }
      if (JSON.stringify(token.selection) !== JSON.stringify(selection)) {
        throw new CliError(
          'events.protocol_incompatible',
          5,
          'The Worker changed the selected event filters.',
        )
      }
      if (!ready) {
        if (record.type !== 'stream.ready') {
          throw new CliError(
            'events.protocol_incompatible',
            5,
            'The Worker did not send the required stream.ready handshake.',
          )
        }
        if (
          JSON.stringify(record.selection) !== JSON.stringify(selection) ||
          record.mode !== (options.after ? 'resume' : 'live') ||
          (lastCursor && record.cursor !== lastCursor)
        ) {
          throw new CliError(
            'events.protocol_incompatible',
            5,
            'The Worker returned an inconsistent stream.ready handshake.',
          )
        }
        ready = true
        clearTimeout(timer)
        await write(record)
        lastCursor = record.cursor
        position = token
        continue
      }
      if (record.type === 'stream.ready') {
        throw new CliError(
          'events.protocol_incompatible',
          5,
          'The Worker repeated the stream handshake.',
        )
      }
      if (record.type === 'stream.gap') {
        await write(record)
        throw new CliError(
          'events.gap',
          1,
          `Event continuity was lost: ${record.reason}.`,
          'Start a fresh stream and query current state if needed.',
          { cursor: lastCursor, reason: record.reason },
        )
      }
      if (
        record.epoch !== token.epoch ||
        record.seq !== token.seq ||
        record.epoch !== position!.epoch
      ) {
        throw new CliError(
          'events.protocol_incompatible',
          5,
          'The Worker returned inconsistent event ordering metadata.',
        )
      }
      if (!selection.types.includes(record.type)) {
        throw new CliError(
          'events.protocol_incompatible',
          5,
          'The Worker sent an event outside the selected types.',
        )
      }
      if (record.seq <= position!.seq) {
        continue
      }
      const visible = eachTurn.includes(record)
      if (visible) {
        await write(record)
        lastCursor = record.cursor
      }
      position = token
      if (eachTurn.observe(record)) {
        return 0
      }
      if (!visible) {
        continue
      }
      count++
      if (
        (options.count !== undefined && count >= Number(options.count)) ||
        record.type === options.until
      ) {
        return 0
      }
    }
    if (signal.aborted) {
      const reason = signal.reason
      if (reason instanceof CliError && lastCursor) {
        reason.details = { ...(reason.details as object), cursor: lastCursor }
      }
      throw reason
    }
    throw new CliError(
      'events.disconnected',
      ready ? 3 : 5,
      ready
        ? 'The event connection closed. Resume with the last cursor.'
        : 'The Worker closed the connection before the v1 handshake.',
      ready
        ? `Run opencove events --after ${lastCursor ?? '<cursor>'}.`
        : 'Update and restart the Worker.',
      { cursor: lastCursor },
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EPIPE') {
      return 0
    }
    if (signal.aborted) {
      const reason = signal.reason
      if (reason instanceof CliError && lastCursor) {
        reason.details = { ...(reason.details as object), cursor: lastCursor }
      }
      throw reason
    }
    if (error instanceof CliError) {
      throw error
    }
    throw new CliError(
      'events.disconnected',
      3,
      'The event connection failed. Resume with the last cursor.',
      `Run opencove events --after ${lastCursor ?? '<cursor>'}.`,
      { cursor: lastCursor },
    )
  } finally {
    clearTimeout(timer)
    io.signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
