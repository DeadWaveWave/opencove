// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { identityFixture, node, project, who } from './cliIdentity.helpers'

it('includes its own terminal summary without changing identity or neighbors', async () => {
  const f = identityFixture()
  expect(await run(['context'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    self: {
      nodeId: who.nodeId,
      node: { id: node.id, kind: 'terminal', title: 'Shell', state: 'running' },
    },
    nodes: [],
  })
})
it.each([false, true])(
  'finds its own agent outside the requested context (root=%s)',
  async root => {
    const f = identityFixture()
    f.values['system.whoami'] = { ...who, spaceId: root ? null : who.spaceId }
    f.values['node.get'] = { node: { ...node, kind: 'agent', sessionId: who.sessionId } }
    f.values['agent.list'] = {
      agents: [
        {
          nodeId: node.id,
          sessionId: who.sessionId,
          state: 'waiting',
          quality: 'authoritative',
          turn: { id: 'turn-self' },
        },
      ],
    }
    f.values['project.list'] = {
      projects: [project, { ...project, id: 'other', activeSpaceId: null }],
    }
    expect(
      await run(
        [
          'context',
          '--project',
          'other',
          '--fields',
          'self.node.id,self.node.state,project.id,nodes',
        ],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toEqual({
      self: { node: { id: node.id, state: 'waiting' } },
      project: { id: 'other' },
      nodes: [],
    })
  },
)
it('keeps self null outside OpenCove', async () => {
  const f = identityFixture(false)
  expect(await run(['context', '--project', project.id], f.io)).toBe(0)
  expect(JSON.parse(f.out()).self).toBeNull()
})
it('keeps identity if the caller node was deleted', async () => {
  const f = identityFixture()
  f.values['node.list'] = { nodes: [] }
  const original = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'node.get'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'node.not_found' } }))
      : original(url, init)
  expect(await run(['context'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).self).toMatchObject({ nodeId: who.nodeId, node: null })
})

it.each(['space-moved', null])(
  'uses the live caller location after moving to %s while preserving grant identity',
  async spaceId => {
    const runs = new AgentRunStateRegistry({
      epoch: 'e',
      now: () => 100,
      createTurnId: () => 'turn-self',
      schedule: () => () => {},
    })
    const grants = new SessionGrantRegistry(sessionId => runs.get({ sessionId }) !== null)
    try {
      runs.register({
        sessionId: who.sessionId,
        nodeId: who.nodeId,
        provider: 'codex',
        incarnation: 'i',
        projectId: who.projectId,
        spaceId: who.spaceId,
      })
      const issued = grants.issue(who)
      runs.observe(who.sessionId, {
        incarnation: 'i',
        source: 'codex_hook',
        sourceSequence: 1,
        observedAt: 100,
        state: 'waiting',
        blockedReason: 'permission',
      })
      runs.bind(who.sessionId, {
        nodeId: who.nodeId,
        projectId: who.projectId,
        spaceId: spaceId ?? undefined,
      })
      expect(runs.list({ spaceId: who.spaceId }).agents).toEqual([])
      expect(runs.get({ nodeId: who.nodeId })).toMatchObject({
        state: 'waiting',
        quality: 'authoritative',
      })
      const grant = grants.verify(issued.token)!
      expect(grant.spaceId).toBe(who.spaceId)
      const f = identityFixture()
      f.io.env.OPENCOVE_CONTROL_TOKEN = issued.token
      f.values['system.whoami'] = { ...who, ...grant }
      f.values['node.list'] = { nodes: [] }
      f.values['node.get'] = {
        node: { ...node, kind: 'agent', title: 'Moved agent', sessionId: who.sessionId, spaceId },
      }
      const original = f.io.fetch
      f.io.fetch = async (url, init) => {
        const request = JSON.parse(String(init?.body))
        if (request.id === 'agent.list') {
          f.requests.push(request)
          return new Response(JSON.stringify({ ok: true, value: runs.list(request.payload) }))
        }
        return original(url, init)
      }
      expect(await run(['context', '--fields', 'self'], f.io)).toBe(0)
      expect(JSON.parse(f.out()).self).toMatchObject({
        caller: 'session-grant',
        projectId: grant.projectId,
        spaceId: grant.spaceId,
        nodeId: grant.nodeId,
        sessionId: grant.sessionId,
        node: {
          id: who.nodeId,
          kind: 'agent',
          title: 'Moved agent',
          state: 'waiting',
          agentState: { state: 'waiting', quality: 'authoritative' },
        },
      })
      expect(
        f.requests.filter(request => request.id === 'agent.list').map(request => request.payload),
      ).toEqual([spaceId ? { spaceId } : { projectId: who.projectId }])
    } finally {
      grants.revokeSession(who.sessionId)
      runs.dispose()
    }
  },
)

it.each([
  { operation: 'agent.list', field: 'self.node.state' },
  { operation: 'node.list', field: 'self.node.taskNodeId' },
  { operation: 'node.get', field: 'self.node.state' },
])(
  'propagates cancellation during root-canvas self enrichment: $operation',
  async ({ operation, field }) => {
    const f = identityFixture()
    f.values['system.whoami'] = { ...who, spaceId: null }
    f.values['node.get'] = {
      node: { ...node, kind: 'agent', spaceId: null, sessionId: who.sessionId },
    }
    f.io.env.OPENCOVE_SPACE_ID = ''
    const controller = new AbortController()
    f.io.signal = controller.signal
    let lookupStarted!: () => void
    const started = new Promise<void>(resolve => {
      lookupStarted = resolve
    })
    const stderr: string[] = []
    f.io.stderr.write = text => {
      stderr.push(text)
    }
    const original = f.io.fetch
    f.io.fetch = async (url, init) => {
      const request = JSON.parse(String(init?.body))
      if (request.id !== operation) {
        return original(url, init)
      }
      f.requests.push(request)
      const signal = init?.signal
      expect(signal).toBeInstanceOf(AbortSignal)
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        lookupStarted()
      })
    }
    const pending = run(['context', '--fields', field], f.io)
    await started
    controller.abort()
    expect(await pending).toBe(130)
    expect(f.out()).toBe('')
    expect(stderr).toHaveLength(1)
    expect(JSON.parse(stderr[0]).error).toMatchObject({
      code: 'cli.interrupted',
      message: 'Interrupted',
    })
    expect(f.requests.filter(request => request.id === operation)).toHaveLength(1)
  },
)

it.each([
  {
    operation: 'agent.list',
    field: 'self.node.state',
    value: { state: 'unknown' },
    notice: 'agent state unavailable',
  },
  {
    operation: 'node.list',
    field: 'self.node.taskNodeId',
    value: { taskNodeId: null },
    notice: 'task links unavailable',
  },
])(
  'keeps ordinary root self metadata failures optional: $operation',
  async ({ operation, field, value, notice }) => {
    const f = identityFixture()
    f.values['system.whoami'] = { ...who, spaceId: null }
    f.values['node.get'] = {
      node: { ...node, kind: 'agent', spaceId: null, sessionId: who.sessionId },
    }
    f.io.env.OPENCOVE_SPACE_ID = ''
    const stderr: string[] = []
    f.io.stderr.write = text => {
      stderr.push(text)
    }
    const original = f.io.fetch
    f.io.fetch = async (url, init) =>
      JSON.parse(String(init?.body)).id === operation
        ? new Response(JSON.stringify({ ok: false, error: { code: 'common.unexpected' } }))
        : original(url, init)
    expect(await run(['context', '--fields', field], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({ self: { node: value } })
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toContain(notice)
  },
)
