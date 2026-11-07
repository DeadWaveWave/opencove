// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import { serveAgentRuntimeEvents } from '../../../src/app/main/controlSurface/http/agentRuntimeSse'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'

it('replays filters from a query watermark, rejects gaps and releases disconnected subscribers', () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'worker',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
    retention: 3,
  })
  registry.register({
    sessionId: 's',
    nodeId: 'n',
    provider: 'codex',
    incarnation: 'i',
    spaceId: 'space',
  })
  const baseline = registry.list()
  registry.observe('s', {
    incarnation: 'i',
    source: 'codex_hook',
    sourceSequence: 1,
    observedAt: 1,
    state: 'working',
    boundary: { kind: 'start', evidence: 'task_started' },
  })
  registry.observe('s', {
    incarnation: 'i',
    source: 'codex_hook',
    sourceSequence: 2,
    observedAt: 1,
    state: 'idle',
    boundary: { kind: 'end', outcome: 'completed' },
  })
  function connect(query: string) {
    const req = new EventEmitter()
    const res = Object.assign(new EventEmitter(), {
      output: '',
      destroyed: false,
      writableEnded: false,
      writeHead: () => {},
      setHeader: () => {},
      write(chunk: string) {
        this.output += chunk
        return true
      },
      end(chunk = '') {
        this.output += chunk
        this.writableEnded = true
        this.emit('close')
      },
      destroy() {
        this.destroyed = true
        this.emit('close')
      },
    })
    const clients = new Set<ServerResponse>()
    serveAgentRuntimeEvents({
      req: req as IncomingMessage,
      res: res as unknown as ServerResponse,
      url: new URL(`http://localhost/events?${query}`),
      registry,
      clients,
      listenerClients: new Set(),
    })
    return { req, res, clients }
  }
  const connection = connect(
    `epoch=${baseline.epoch}&afterSeq=${baseline.seq}&types=agent.turn_completed&nodeId=n&spaceId=space`,
  )
  expect(connection.res.output).toContain('"turnOutcome":"completed"')
  expect(connection.res.output).not.toContain('agent.state_changed')
  const excluded = connect('epoch=worker&afterSeq=1&nodeId=other')
  expect(excluded.res.output).not.toContain('data:')
  expect(connect('epoch=old&afterSeq=4').res.output).toContain('resync_required')
  expect(connect('epoch=worker&afterSeq=0').res.output).toContain('resync_required')
  expect(connect('afterSeq=4').res.output).toContain('resync_required')
  connection.req.emit('close')
  expect(connection.clients.size).toBe(0)
  const before = connection.res.output
  registry.observe('s', {
    incarnation: 'i',
    source: 'exit',
    sourceSequence: 3,
    observedAt: 2,
    state: 'exited',
  })
  expect(connection.res.output).toBe(before)
  excluded.req.emit('close')
  registry.dispose()
})
