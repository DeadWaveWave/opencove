/* eslint-disable no-await-in-loop -- Ordered restart and publication acceptance. */
import { expect, test } from '@playwright/test'
import { defaultsHarness } from './recovery.managed-claude-defaults.helpers'
import { getBinding, launch } from './recovery.managed-claude-launch-lifecycle.helpers'
import { syntheticRebind } from './managedClaudeContinuity.helpers'
import { staleManagedPublication } from '../support/convergence/staleManagedPublication'
import { waitForControlSurfaceConnection } from './controlSurfaceConnection.helpers'

test('upgrades verified unowned A at cold recovery and saves a qualified clear successor', async () => {
  test.setTimeout(180_000)
  const f = await defaultsHarness('claude-clear-ordering')
  try {
    let page = await f.start(true) // Establish a pre-upgrade profile without ownership.
    await f.seed()
    const agent = await f.createAgent()
    await expect
      .poll(async () => (await f.persistedNode(agent.id)).agent.resumeSessionIdVerified)
      .toBe(true)
    const before = await f.persistedNode(agent.id)
    expect((await f.readNode(agent.id)).managedClaudeBinding).toBeFalsy()
    const a = before.agent.resumeSessionId
    page = await f.start(false, agent.id)
    expect(f.getColdReceipt()).toMatchObject({
      nodes: [{ managedClaudeLifecycle: { binding: { tuple: { resumeSessionId: a } } } }],
    })
    await expect
      .poll(() => getBinding(page, agent.id))
      .toMatchObject({
        tuple: { resumeSessionId: a, resumeSessionIdVerified: true },
        nodeSeen: true,
      })
    await expect
      .poll(async () =>
        (await f.records()).some(r => r.mode === 'resume' && r.id === a && r.cwd === f.workspace),
      )
      .toBe(true)
    const after = await f.persistedNode(agent.id)
    expect(after.workerBinding).toEqual(before.workerBinding)
    expect(after.agent.executionDirectory).toBe(f.workspace)
    // A lifecycle receipt reached hydration, independently of the store query.
    await expect(page.locator(`[data-id="${agent.id}"] .terminal-node__terminal`)).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 20_000 },
    )
    const runtime = (await getBinding(page, agent.id)).runtimeSessionId!
    await page.evaluate(
      async sessionId => window.opencoveApi.pty.write({ sessionId, data: 'reverse\r' }),
      runtime,
    )
    await expect
      .poll(async () => (await f.records()).find(r => r.scenario === 'reverse')?.id)
      .toBeTruthy()
    const b = (await f.records()).find(r => r.scenario === 'reverse')!.id!
    await expect
      .poll(() => getBinding(page, agent.id))
      .toMatchObject({ tuple: { resumeSessionId: b, resumeSessionIdVerified: true } })
  } finally {
    await f.close()
  }
})

test('freezes owned B across Worker restart while legacy creation and layout remain usable', async () => {
  test.setTimeout(240_000)
  const f = await defaultsHarness('claude-session-ownership')
  try {
    let page = await f.start()
    await f.seed()
    const agent = await f.createAgent()
    const initial = await getBinding(page, agent.id)
    await expect.poll(async () => (await f.records()).length).toBeGreaterThan(0)
    const b = await syntheticRebind(
      f.userDataDir,
      f.home,
      f.workspace,
      agent.id,
      initial.tuple.resumeSessionId!,
    )
    const count = (await f.records()).length
    page = await f.start(true)
    expect((await f.capabilities()).features).toMatchObject({
      managedClaudeResumeBindingV1: true,
      managedClaudeResumeBindingDeliveryV1: true,
      managedClaudeResumeBindingWritesEnabled: false,
    })
    const current = await getBinding(page, agent.id)
    expect(current.tuple.resumeSessionId).toBe(b)
    await expect(
      page
        .getByText('Managed Claude restarts and saving new resume targets are paused.', {
          exact: false,
        })
        .first(),
    ).toBeVisible()
    await expect(
      launch(page, agent.id, f.workspace, {
        kind: 'launchNew',
        expected: { activationId: current.activationId, tuple: current.tuple },
      }),
    ).rejects.toThrow(/paused/)
    await expect(
      page.evaluate(
        async nodeId =>
          window.opencoveApi.controlSurface.invoke({
            kind: 'command',
            id: 'session.prepareOrRevive',
            clientFeatures: { managedClaudeResumeBindingV1: true },
            payload: { workspaceId: 'managed-launch-project', nodeIds: [nodeId] },
          }),
        agent.id,
      ),
    ).rejects.toThrow(/paused/)
    expect((await f.records()).length).toBe(count)
    for (const raw of [false, true]) {
      const latest = await page.evaluate(async () => window.opencoveApi.persistence.readAppState())
      const proposed = staleManagedPublication(latest.state, agent.id, raw ? 1300 : 1200)
      const staleNode = proposed.candidate.workspaces
        .flatMap(w => w.nodes)
        .find(n => n.id === agent.id)!
      Object.assign(staleNode.agent!, initial.tuple) // Publish the actual pre-clear A under freeze.
      const result = await page.evaluate(
        async ({ state, revision, rawWrite }) =>
          rawWrite
            ? window.opencoveApi.persistence.writeWorkspaceStateRaw({ raw: JSON.stringify(state) })
            : window.opencoveApi.persistence.writeAppState({ state, baseRevision: revision }),
        { state: proposed.candidate, revision: latest.revision, rawWrite: raw },
      )
      expect(result).toMatchObject({ ok: true })
      expect((await getBinding(page, agent.id)).tuple.resumeSessionId).toBe(b)
      expect((await f.readNode(agent.id)).node.frame.x).toBe(raw ? 1300 : 1200)
    }
    const connection = await waitForControlSurfaceConnection(f.userDataDir)
    const refused = await fetch(`${connection.endpoint}/_test/managed-claude-rebind`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: agent.id, resumeSessionId: initial.tuple.resumeSessionId }),
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({
      ok: false,
      error: { details: { reason: 'writesDisabled' } },
    })
    const legacy = await f.createAgent() // Also proves an unrelated granted CLI terminal works.
    expect((await f.readNode(legacy.id)).managedClaudeBinding).toBeFalsy()
    page = await f.start()
    await expect
      .poll(async () =>
        (await f.records()).slice(count).some(r => r.mode === 'resume' && r.sessionId === b),
      )
      .toBe(true)
    expect((await getBinding(page, agent.id)).tuple.resumeSessionId).toBe(b)
  } finally {
    await f.close()
  }
})
