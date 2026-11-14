/* eslint-disable no-await-in-loop -- Each request observes the preceding runtime transition. */
import { expect, test } from '@playwright/test'
import {
  boundedWorkspace,
  expectSpawnRefusal,
  projectId,
  runtimeCounts,
  runtimePid,
  expectRuntimeExited,
  restartLineageWorker,
  reviveNode,
} from './lineage.helpers'
import { recoveredDescendants, runtimeKinds } from '../../support/boundedSpawning'
import type {
  CanvasNodeDetailDto,
  GetNodeResult,
} from '../../../src/shared/contracts/dto/nodeControl'

test('granted run-agent and generic raw launch are refused with migration guidance', async () => {
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    const before = await runtimeCounts(f.worker)
    for (const args of [
      ['session', 'run-agent', '--prompt', 'Help me'],
      [
        'api',
        'call',
        'session.launchAgent',
        '--input',
        JSON.stringify({ cwd: f.worker.workspace, prompt: 'Help me' }),
      ],
    ]) {
      const error = expectSpawnRefusal(await f.command(f.parent, args), 'common.forbidden', 4)
      expect(error.hint).toContain('node create')
    }
    expect(await runtimeCounts(f.worker)).toEqual(before)
  })
})

test('a user standalone session keeps non-runtime grants but needs a canvas agent to delegate runtimes', async () => {
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    // Use the user's real launch route. The mailbox name is only a fixture filename;
    // OPENCOVE_NODE_ID remains absent and the CLI authenticates its inherited grant.
    const standalone = await f.worker.invoke<{ sessionId: string }>('session.launchAgent', {
      workspaceId: projectId,
      cwd: f.worker.workspace,
      provider: 'claude-code',
      prompt: 'Help me review',
    })
    expect(standalone.sessionId).toBeTruthy()
    const mailbox = { id: 'undefined' }
    const who = await f.command(mailbox, ['whoami'])
    expect(who.code, who.stderr).toBe(0)
    expect(JSON.parse(who.stdout)).toMatchObject({ caller: 'session-grant', nodeId: null })
    const note = await f.command(mailbox, [
      'node',
      'create',
      'note',
      '--root-canvas',
      '--project',
      projectId,
      '--text',
      'Findings',
    ])
    expect(note.code, note.stderr).toBe(0)
    const before = await runtimeCounts(f.worker)
    for (const kind of runtimeKinds) {
      const result = await f.command(mailbox, [
        'node',
        'create',
        kind,
        '--root-canvas',
        '--project',
        projectId,
      ])
      const error = expectSpawnRefusal(result, 'common.forbidden', 4)
      expect(error.hint).toContain('canvas')
    }
    expect(await runtimeCounts(f.worker)).toEqual(before)
  })
})

test('deletion releases after runtime exit and Worker restart preserves lineage and its orphan fence', async () => {
  await boundedWorkspace(async f => {
    const children: CanvasNodeDetailDto[] = []
    for (const kind of recoveredDescendants) {
      children.push(await f.child(f.parent, kind))
    }
    const removed = children.pop()!
    const pid = await runtimePid(f.worker, removed)
    await f.worker.invoke('node.delete', { nodeId: removed.id })
    await expect
      .poll(
        async () =>
          (
            await f.worker.invoke<{ sessions: { sessionId: string; status: string }[] }>(
              'session.list',
              null,
              'query',
            )
          ).sessions.find(s => s.sessionId === removed.sessionId)?.status,
      )
      .toBe('exited')
    await expectRuntimeExited(pid)
    const replacement = await f.child(f.parent, 'terminal')
    await restartLineageWorker(f.worker, children[0])
    for (const child of [...children, replacement]) {
      const node = (await f.worker.invoke<GetNodeResult>('node.get', { nodeId: child.id }, 'query'))
        .node
      expect(node).toMatchObject({ spawnedBy: f.parent.id, lineageDepth: 2 })
      await reviveNode(f.worker, child.id)
    }
    expectSpawnRefusal(
      await f.command(children[0], ['node', 'create', 'terminal', '--root-canvas']),
      'common.unavailable',
      1,
    )
  })
})

test('Worker restart counts recovered live descendants rather than saved session IDs', async () => {
  await boundedWorkspace(async f => {
    const children: CanvasNodeDetailDto[] = []
    for (const kind of recoveredDescendants) {
      children.push(await f.child(f.parent, kind))
    }
    const oldPids = await Promise.all(children.map(node => runtimePid(f.worker, node)))
    const child = await restartLineageWorker(f.worker, children[0])
    // A real restart ends the old processes. Persisted nodes alone cannot fill the budget.
    for (const pid of oldPids) {
      await expectRuntimeExited(pid)
    }
    const partial = await f.command(child, ['whoami', '--fields', 'lineageQuota.liveInTree'])
    expect(partial.code, partial.stderr).toBe(0)
    expect(JSON.parse(partial.stdout)).toEqual({ lineageQuota: { liveInTree: 1 } })
    const recovered = [child]
    for (const terminal of children.slice(1)) {
      recovered.push(await reviveNode(f.worker, terminal.id))
    }
    const pids = await Promise.all(recovered.map(node => runtimePid(f.worker, node)))
    expect(new Set(pids).size).toBe(6)
    expect((await f.worker.liveProcesses()).filter(pid => pids.includes(pid))).toHaveLength(6)
    expectSpawnRefusal(
      await f.command(child, ['node', 'create', 'terminal', '--root-canvas']),
      'agent.spawn_concurrency_limit',
      1,
    )
  })
})
