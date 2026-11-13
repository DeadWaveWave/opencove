import { vi } from 'vitest'
import type { CliIo } from '../../../src/app/cli/core/io'
import {
  canonicalSelection,
  encodeEventCursor,
} from '../../../src/shared/contracts/dto/eventStream'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
export const selection = canonicalSelection({})
export const token = (seq: number, selected = selection) =>
  encodeEventCursor({ version: 1, epoch: 'e', seq, selection: selected })
export const ready = { version: 1, type: 'stream.ready', cursor: token(1), selection, mode: 'live' }
const registry = new AgentRunStateRegistry({
  epoch: 'e',
  now: () => 1,
  createTurnId: () => 't',
  schedule: () => () => {},
})
registry.register({ sessionId: 's', nodeId: 'n', provider: 'codex', incarnation: 'i' })
export const data = (seq: number) => ({
  version: 1,
  type: 'agent.state_changed',
  epoch: 'e',
  seq,
  cursor: token(seq),
  snapshot: registry.get({ sessionId: 's' }),
  projectId: null,
  spaceId: null,
  spawnedBy: null,
  lineageDepth: 1,
  lineageStatus: 'root',
})
export function fixture(records: unknown[], env: CliIo['env'] = {}) {
  let stdout = '',
    stderr = ''
  const cancel = vi.fn()
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith('/invoke')
      ? new Response(
          JSON.stringify({
            ok: true,
            value: { features: { eventStreamV1: true, nodeLineageV1: true } },
          }),
        )
      : new Response(
          new ReadableStream({
            start(c) {
              for (const record of records) {
                c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(record)}\n\n`))
              }
              c.close()
            },
            cancel,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
  )
  const io: CliIo = {
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'secret', ...env },
    stdout: {
      write(s) {
        stdout += s
      },
    },
    stderr: {
      write(s) {
        stderr += s
      },
    },
    fetch: fetch as typeof globalThis.fetch,
    now: Date.now,
    readTextFile: async () => '',
    readStdinText: async () => '',
  }
  return { io, fetch, cancel, out: () => stdout, err: () => stderr }
}
