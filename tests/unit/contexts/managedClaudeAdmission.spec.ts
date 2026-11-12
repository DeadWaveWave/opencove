import { expect, it, vi } from 'vitest'
import { compatibilityFixture, context, absent } from './managedClaudeLaunchCompatibility.helpers'

const features = { managedClaudeResumeBindingV1: true } as const
it.each([false, true])('does not adopt for an older client, flag enabled=%s', async enabled => {
  const f = compatibilityFixture({ enabled })
  const result = await f.launch({ intent: { kind: 'launchNew', expected: absent } }, {})
  expect(result.ok).toBe(true)
  expect(f.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  f.runtime.dispose()
})
it('refuses an owned legacy request before reserve without superseding an admitted attempt', async () => {
  const f = compatibilityFixture({ enabled: true })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'A',
    runtimeSessionId: 'live',
    tuple: absent.tuple,
  })
  const attempt = f.runtime.owner.reserve('agent')
  const reserve = vi.spyOn(f.runtime.owner, 'reserve')
  const result = await f.launch({}, {})
  expect(result).toMatchObject({
    ok: false,
    error: { details: { reason: 'clientUpgradeRequired' } },
  })
  expect(reserve).not.toHaveBeenCalled()
  expect(f.runtime.owner.isCurrent(attempt)).toBe(true)
  expect(f.spawn).not.toHaveBeenCalled()
  f.runtime.dispose()
})
it('keeps live owned preparation available to older callers and refuses cold reservation', async () => {
  const f = compatibilityFixture()
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'A',
    runtimeSessionId: 'live',
    tuple: absent.tuple,
  })
  // The fixture reports live runtimes; reattach does not reserve at all.
  expect(f.runtime.reservePreparation({ ...context, clientFeatures: {} }, 'workspace').size).toBe(0)
  expect(
    f.runtime.reservePreparation({ ...context, clientFeatures: features }, 'workspace').size,
  ).toBe(0)
  f.runtime.dispose()
})

it('refuses legacy execution if ownership appears while identity resolution is pending', async () => {
  const f = compatibilityFixture({ enabled: true })
  let release!: () => void
  const pendingIdentity = new Promise<void>(resolve => {
    release = resolve
  })
  const read = f.store.readAppState.mockImplementationOnce(async () => {
    await pendingIdentity
    return f.state
  })
  const launching = f.launch({}, {})
  await vi.waitFor(() => expect(read).toHaveBeenCalled())
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'new-owner',
    runtimeSessionId: 'live',
    tuple: absent.tuple,
  })
  release()
  expect(await launching).toMatchObject({
    ok: false,
    error: { details: { reason: 'clientUpgradeRequired' } },
  })
  expect(f.spawn).not.toHaveBeenCalled()
  f.runtime.dispose()
})
