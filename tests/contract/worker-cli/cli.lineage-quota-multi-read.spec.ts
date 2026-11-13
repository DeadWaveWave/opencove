/* eslint-disable no-await-in-loop -- Each creation observes the previous admission. */
import { expect, test } from '@playwright/test'
import { boundedWorkspace, expectSpawnRefusal, projectId, stopAndWait } from './lineage.helpers'

test('quota projections agree with depth/width refusals and identify stoppable occupants', async () => {
  test.setTimeout(360_000)
  await boundedWorkspace(async f => {
    const child = await f.child(f.parent),
      grandchild = await f.child(child)
    for (let i = 0; i < 4; i++) {
      await f.child(f.parent, 'terminal')
    }
    const who = await f.command(f.parent, ['whoami', '--fields', 'lineageQuota'])
    expect(who.code, who.stderr).toBe(0)
    expect(JSON.parse(who.stdout)).toEqual({
      lineageQuota: {
        depth: 1,
        maxDepth: 3,
        liveInTree: 6,
        maxLiveInTree: 6,
        remainingLiveInTree: 0,
      },
    })
    const context = await f.command(grandchild, [
      'context',
      '--project',
      projectId,
      '--fields',
      'self.lineageQuota',
    ])
    expect(context.code, context.stderr).toBe(0)
    expect(JSON.parse(context.stdout)).toEqual({
      self: {
        lineageQuota: {
          depth: 3,
          maxDepth: 3,
          liveInTree: 6,
          maxLiveInTree: 6,
          remainingLiveInTree: 0,
        },
      },
    })
    for (const [caller, code] of [
      [grandchild, 'agent.spawn_depth_limit'],
      [f.parent, 'agent.spawn_concurrency_limit'],
    ] as const) {
      const error = expectSpawnRefusal(
        await f.command(caller, ['node', 'create', 'terminal', '--root-canvas']),
        code,
        1,
      )
      expect(error.details.nodes).toHaveLength(6)
      expect(error.details.nodes).toContainEqual({
        nodeId: grandchild.id,
        title: grandchild.title,
        kind: 'agent',
        depth: 3,
        state: 'running',
        sessionId: grandchild.sessionId,
        sessionStartedAt: expect.any(String),
      })
      expect(error.hint).toContain(grandchild.title)
      expect(error.hint).toContain(`opencove agent stop --node ${grandchild.id}`)
    }
    await stopAndWait(f.worker, grandchild)
    await expect
      .poll(async () => {
        const result = await f.command(f.parent, ['whoami', '--fields', 'lineageQuota.liveInTree'])
        return JSON.parse(result.stdout).lineageQuota.liveInTree
      })
      .toBe(5)
    await f.child(f.parent, 'terminal')
  })
})

test('multi-read keeps live Worker replies and missing-selector errors in input order', async () => {
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    const child = await f.child(f.parent)
    const result = await f.command(f.parent, [
      'agent',
      'read',
      '--node',
      child.id,
      '--node',
      'missing-reviewer',
      '--node',
      '@self',
      '--node',
      child.id,
    ])
    expect(result.code, result.stderr).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual([
      expect.objectContaining({
        node: child.id,
        ok: true,
        nodeId: child.id,
        source: 'hook',
        message: expect.any(String),
      }),
      {
        node: 'missing-reviewer',
        ok: false,
        error: expect.objectContaining({ code: 'node.not_found' }),
      },
      expect.objectContaining({
        node: '@self',
        ok: true,
        nodeId: f.parent.id,
        source: 'hook',
        message: expect.any(String),
      }),
      expect.objectContaining({ node: child.id, ok: true, nodeId: child.id }),
    ])
    const exact = await f.command(f.parent, [
      'agent',
      'read',
      '--node',
      child.id,
      '--node',
      '@self',
      '--turn',
      'turn-1',
    ])
    expect(exact.code).toBe(2)
    expect(exact.stderr).toContain('single target')
  })
})
