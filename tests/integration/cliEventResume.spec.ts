// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { run } from '../../src/app/cli/core/run'
import type { CliIo } from '../../src/app/cli/core/io'
import { serveCliEventStream } from '../../src/app/main/controlSurface/http/cliEventStream'
import { AgentRunStateRegistry } from '../../src/contexts/agent/application/AgentRunStateRegistry'

it('manually resumes across real adapter disconnect without missing or duplicating publication IDs', async () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  let disconnect: (() => void) | undefined
  const invokeIds: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/invoke') {
      invokeIds.push(JSON.parse(String(init?.body)).id)
      return new Response(
        JSON.stringify({
          ok: true,
          value: { features: { eventStreamV1: true, nodeLineageV1: true } },
        }),
      )
    }
    const req = new EventEmitter() as IncomingMessage
    let closed = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const res = Object.assign(new EventEmitter(), {
          destroyed: false,
          writableEnded: false,
          writeHead() {},
          write(text: string) {
            if (!closed) {
              controller.enqueue(new TextEncoder().encode(text))
            }
            return !closed
          },
          end() {
            if (!closed) {
              closed = true
              res.writableEnded = true
              controller.close()
            }
          },
        })
        const dispose = serveCliEventStream({
          req,
          res: res as unknown as ServerResponse,
          url,
          registry,
          clients: new Set(),
          listenerClients: new Set(),
          isActive: () => !closed,
          readLineage: async () => ({ readMany: async () => new Map() }),
        })
        disconnect = dispose
        init?.signal?.addEventListener('abort', dispose, { once: true })
      },
      cancel() {
        req.emit('close')
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }
  const publish = (id: string) =>
    registry.register({ sessionId: id, nodeId: id, provider: 'codex', incarnation: id })
  const records: Array<{ type: string; epoch?: string; seq?: number; cursor: string }> = []
  let stderr = ''
  const io: CliIo = {
    env: { OPENCOVE_CONTROL_URL: 'http://fixture', OPENCOVE_CONTROL_TOKEN: 'secret' },
    fetch: fetcher,
    now: Date.now,
    readStdinText: async () => '',
    readTextFile: async () => '',
    stdout: { write() {} },
    stderr: {
      write(text) {
        stderr += text
      },
    },
    async writeRecord(text) {
      const record = JSON.parse(text)
      records.push(record)
      if (record.type === 'stream.ready' && records.length === 1) {
        publish('one')
        publish('two')
      }
      if (record.seq === 2) {
        disconnect!()
      }
    },
  }
  expect(await run(['events'], io)).toBe(3)
  const cursor = JSON.parse(stderr).error.details.cursor
  expect(records.filter(r => r.seq).map(r => [r.epoch, r.seq])).toEqual([
    ['e', 1],
    ['e', 2],
  ])
  // These publications genuinely occur with no open subscription.
  publish('three')
  publish('four')
  const previous = records.length
  expect(await run(['events', '--after', cursor, '--count', '2'], io)).toBe(0)
  expect(records[previous]).toMatchObject({ type: 'stream.ready', cursor })
  expect(records.filter(r => r.seq).map(r => [r.epoch, r.seq])).toEqual([
    ['e', 1],
    ['e', 2],
    ['e', 3],
    ['e', 4],
  ])
  expect(invokeIds).toEqual(['system.capabilities', 'system.capabilities'])
})
