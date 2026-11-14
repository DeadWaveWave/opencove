// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fixture, now } from './nodeControlTask.fixture'
import {
  claimTask,
  releaseTask,
} from '../../../src/contexts/workspace/application/nodeControl/nodeTaskMutations'
import { appendNote } from '../../../src/contexts/workspace/application/nodeControl/nodeNoteAppend'
import type { NodeControlNode } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

function setup() {
  const f = fixture()
  f.advance(s => {
    const w = s.workspaces[0]
    for (const id of ['a', 'b']) {
      w.nodes.push({
        ...structuredClone(w.nodes[0]),
        id,
        title: id,
        kind: 'agent',
        agent: { taskId: null },
      })
      w.spaces[0].nodeIds.push(id)
    }
    w.nodes.push({ ...structuredClone(w.nodes[0]), id: 'note', kind: 'note', task: { text: '' } })
  })
  const authority = { projectId: 'project', nodeId: 'a' }
  return {
    ...f,
    authority,
    claim: (agentNodeId = 'a') =>
      claimTask({ store: f.store, now, input: { taskNodeId: 'task', agentNodeId } }),
    release: (grant = true) =>
      releaseTask({
        store: f.store,
        now,
        authority: grant ? authority : undefined,
        input: { taskNodeId: 'task', status: 'ai_done' },
      }),
    append: (text: string) =>
      appendNote({ store: f.store, input: { nodeId: 'note', text }, authority }),
    node: (id: string): NodeControlNode =>
      f
        .state()
        .workspaces.flatMap(w => w.nodes)
        .find(n => n.id === id)!,
  }
}

// Hold both first snapshots at the write boundary, then allow real revision checks.
function barrier(f: ReturnType<typeof setup>) {
  const write = f.write.getMockImplementation()!
  let count = 0
  let open!: () => void
  const ready = new Promise<void>(resolve => {
    open = resolve
  })
  f.write.mockImplementation(async (s, o) => {
    if (++count <= 2) {
      if (count === 2) {
        open()
      }
      await ready
    }
    return write(s, o)
  })
}

describe('task relationship CAS', () => {
  it.each(['missing', 'non-agent'])('replaces a structurally stale %s holder', async stale => {
    const f = setup()
    f.node('task').task = {
      ...(f.node('task').task as object),
      linkedAgentNodeId: stale === 'missing' ? 'gone' : 'note',
    }
    expect(await f.claim()).toMatchObject({ changed: true })
  })
  it('does not steal from an exited agent or require runtime observation', async () => {
    const f = setup()
    await f.claim('b')
    f.node('b').status = 'exited'
    await expect(f.claim()).rejects.toMatchObject({ code: 'task.already_claimed' })
  })
  it('permits a root-to-root claim and repairs a self-held task without changing lastRunAt', async () => {
    const f = setup()
    f.advance(s => {
      s.workspaces[0].spaces[0].nodeIds = []
    })
    await f.claim()
    const lastRunAt = (f.node('task').task as Record<string, unknown>).lastRunAt
    f.node('task').task = { ...(f.node('task').task as object), status: 'todo' }
    f.node('a').agent = { taskId: null }
    expect(
      await claimTask({
        store: f.store,
        now: new Date('2026-11-13T00:00:00Z'),
        input: { taskNodeId: 'task', agentNodeId: 'a' },
      }),
    ).toMatchObject({ changed: true })
    expect(f.node('task').task).toMatchObject({
      lastRunAt,
      status: 'doing',
      updatedAt: '2026-11-13T00:00:00.000Z',
    })
  })
  it('requires an explicit agent from a user, and defaults release to todo', async () => {
    const f = setup()
    await expect(
      claimTask({ store: f.store, now, input: { taskNodeId: 'task' } }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
    await f.claim()
    expect(await releaseTask({ store: f.store, now, input: { taskNodeId: 'task' } })).toMatchObject(
      { node: { data: { status: 'todo' } } },
    )
  })
  it('commits reciprocal state and preserves timestamps on a checked idempotent claim', async () => {
    const f = setup()
    const first = await f.claim()
    expect(first).toMatchObject({
      changed: true,
      node: { data: { status: 'doing', linkedAgentNodeId: 'a' } },
    })
    expect(f.node('a').agent).toMatchObject({ taskId: 'task' })
    const before = structuredClone(f.node('task'))
    expect(await f.claim()).toMatchObject({ changed: false })
    expect(f.node('task')).toEqual(before)
    expect(f.write).toHaveBeenCalledTimes(2)
  })
  it('allows only one competing holder and reports the winner', async () => {
    const f = setup()
    barrier(f)
    const results = await Promise.allSettled([f.claim('a'), f.claim('b')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    const holder = (f.node('task').task as { linkedAgentNodeId: string }).linkedAgentNodeId
    expect(loser.reason).toMatchObject({
      code: 'task.already_claimed',
      details: { taskNodeId: 'task', holder: { nodeId: holder, title: holder } },
    })
  })
  it('allows only one of two creators to commit', async () => {
    const f = setup()
    barrier(f)
    const results = await Promise.allSettled([f.run(), f.run()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(f.runtime.launchAgent).toHaveBeenCalledTimes(2)
    expect(f.runtime.killSession).toHaveBeenCalledTimes(1)
  })
  it('arbitrates creator versus claim at the same revision', async () => {
    const f = setup()
    barrier(f)
    const results = await Promise.allSettled([f.run(), f.claim()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  })
  it.each(['deleted', 'kind', 'project', 'space'])(
    'revalidates %s after conflict',
    async scenario => {
      const f = setup(),
        write = f.write.getMockImplementation()!
      f.write.mockImplementationOnce(async (s, o) => {
        f.advance(state => {
          const w = state.workspaces[0]
          if (scenario === 'deleted') {
            w.nodes = w.nodes.filter(n => n.id !== 'task')
          }
          if (scenario === 'kind') {
            w.nodes[0].kind = 'note'
          }
          if (scenario === 'project') {
            state.workspaces.push({
              ...structuredClone(w),
              id: 'other',
              nodes: [w.nodes[0]],
              spaces: [],
            })
            w.nodes.shift()
          }
          if (scenario === 'space') {
            w.spaces[0].nodeIds = w.spaces[0].nodeIds.filter(id => id !== 'task')
          }
        })
        return write(s, o)
      })
      await expect(f.claim()).rejects.toMatchObject({
        code: scenario === 'deleted' ? 'node.not_found' : 'common.invalid_input',
      })
      expect(f.write).toHaveBeenCalledTimes(1)
    },
  )
  it('rechecks the holder before releasing after a conflict', async () => {
    const f = setup()
    await f.claim()
    const write = f.write.getMockImplementation()!
    f.write.mockImplementationOnce(async (s, o) => {
      f.advance(() => {
        f.node('task').task = { ...(f.node('task').task as object), linkedAgentNodeId: 'b' }
      })
      return write(s, o)
    })
    await expect(f.release()).rejects.toMatchObject({
      code: 'common.forbidden',
      details: { reason: 'not_current_holder', holder: { nodeId: 'b' } },
    })
  })
  it('releases after a Space move without touching history or another reciprocal link', async () => {
    const f = setup()
    await f.claim()
    f.advance(s => {
      s.workspaces[0].spaces[0].nodeIds = ['b']
      f.node('a').agent = { taskId: 'other' }
      f.node('task').task = {
        ...(f.node('task').task as object),
        agentSessions: [{ id: 'history' }],
      }
    })
    const result = await f.release()
    expect(result).toMatchObject({
      changed: true,
      node: { data: { linkedAgentNodeId: null, status: 'ai_done' } },
    })
    expect(f.node('task').task).toMatchObject({
      agentSessions: [{ id: 'history' }],
      lastRunAt: now.toISOString(),
    })
    expect(f.node('a').agent).toEqual({ taskId: 'other' })
    await expect(f.release()).rejects.toMatchObject({ code: 'common.forbidden' })
    expect(await f.release(false)).toMatchObject({ changed: false })
  })
  it('clears the applicable reciprocal field only', async () => {
    const f = setup()
    await f.claim()
    await f.release()
    expect(f.node('a').agent).toEqual({ taskId: null })
  })
  it('defaults claim to authenticated identity and rejects impersonation and foreign projects', async () => {
    const f = setup()
    const call = (agentNodeId?: string, authority = f.authority) =>
      claimTask({ store: f.store, now, authority, input: { taskNodeId: 'task', agentNodeId } })
    await expect(call('b')).rejects.toMatchObject({ code: 'common.forbidden' })
    await expect(call('a', { ...f.authority, projectId: 'foreign' })).rejects.toMatchObject({
      code: 'common.forbidden',
    })
    expect(await call()).toMatchObject({ changed: true })
  })
  it('does not treat an existing self-link as acquisition of a second task', async () => {
    const f = setup()
    await f.claim()
    f.advance(s =>
      s.workspaces[0].nodes.push({ ...structuredClone(f.node('task')), id: 'legacy-duplicate' }),
    )
    expect(await f.claim()).toMatchObject({ changed: false })
    expect(f.node('legacy-duplicate').task).toMatchObject({ linkedAgentNodeId: 'a' })
  })
  it('refuses a second task but ignores stale agent.taskId', async () => {
    const f = setup()
    f.node('a').agent = { taskId: 'gone' }
    await f.claim()
    f.advance(s =>
      s.workspaces[0].nodes.push({ ...structuredClone(f.node('task')), id: 'second', task: {} }),
    )
    await expect(
      claimTask({ store: f.store, now, input: { taskNodeId: 'second', agentNodeId: 'a' } }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
  })
  it('retries unrelated conflicts, but stops at three attempts or any non-conflict error', async () => {
    const f = setup(),
      write = f.write.getMockImplementation()!
    f.write.mockImplementationOnce(async (s, o) => {
      f.advance(state => {
        state.workspaces[0].name = 'renamed'
      })
      return write(s, o)
    })
    await f.claim()
    expect(f.state().workspaces[0].name).toBe('renamed')
    f.write.mockClear().mockResolvedValue({
      ok: false,
      reason: 'unknown',
      error: createAppErrorDescriptor('persistence.invalid_state', {
        debugMessage: 'App state revision conflict (test)',
      }),
    })
    await expect(f.claim()).rejects.toMatchObject({ code: 'persistence.invalid_state' })
    expect(f.write).toHaveBeenCalledTimes(3)
    f.write.mockClear().mockResolvedValue({
      ok: false,
      reason: 'io',
      error: createAppErrorDescriptor('persistence.io_failed'),
    })
    await expect(f.claim()).rejects.toMatchObject({ code: 'persistence.io_failed' })
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('honors revocation immediately before commit', async () => {
    const f = setup(),
      assertActive = vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementation(() => {
          throw new Error('revoked')
        })
    await expect(
      claimTask({
        store: f.store,
        now,
        input: { taskNodeId: 'task', agentNodeId: 'a' },
        assertActive,
      }),
    ).rejects.toThrow('revoked')
    expect(f.write).not.toHaveBeenCalled()
  })
})

describe('note append CAS', () => {
  it('preserves concurrent payloads once each in commit order', async () => {
    const f = setup()
    barrier(f)
    const results = await Promise.all([f.append(' first '), f.append('第二')])
    expect(f.node('note').task).toEqual({ text: ' first \n\n第二' })
    expect(results).toMatchObject([
      { appendedBytes: 7, totalBytes: 7 },
      { appendedBytes: 8, totalBytes: 15 },
    ])
  })
  it('treats absent legacy text as empty and retains whitespace', async () => {
    const f = setup()
    f.node('note').task = {}
    expect(await f.append(' \n')).toMatchObject({ appendedBytes: 2, totalBytes: 2 })
  })
  it.each(['', '界'.repeat(21846)])('rejects empty or oversized UTF-8 input', async text => {
    const f = setup()
    await expect(f.append(text)).rejects.toMatchObject({ code: 'common.invalid_input' })
    expect(f.write).not.toHaveBeenCalled()
  })
  it('checks the result byte limit again after a competing append', async () => {
    const f = setup(),
      write = f.write.getMockImplementation()!
    f.write.mockImplementationOnce(async (s, o) => {
      f.advance(() => {
        f.node('note').task = { text: 'x'.repeat(1024 * 1024 - 2) }
      })
      return write(s, o)
    })
    await expect(f.append('a')).rejects.toMatchObject({ code: 'common.invalid_input' })
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('accepts the exact per-append and body limits', async () => {
    const f = setup()
    await f.append('x'.repeat(65536))
    f.node('note').task = { text: 'x'.repeat(1024 * 1024 - 3) }
    expect(await f.append('a')).toMatchObject({ totalBytes: 1024 * 1024 })
  })
  it('rejects wrong kind and project but allows a node-less same-project grant', async () => {
    const f = setup()
    await expect(
      appendNote({ store: f.store, input: { nodeId: 'task', text: 'a' } }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
    await expect(
      appendNote({
        store: f.store,
        input: { nodeId: 'note', text: 'a' },
        authority: { projectId: 'other', nodeId: null },
      }),
    ).rejects.toMatchObject({ code: 'common.forbidden' })
    expect(
      await appendNote({
        store: f.store,
        input: { nodeId: 'note', text: 'a' },
        authority: { projectId: 'project', nodeId: null },
      }),
    ).toMatchObject({ totalBytes: 1 })
  })
})
