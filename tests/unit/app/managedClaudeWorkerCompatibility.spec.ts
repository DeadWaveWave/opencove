import { expect, it } from 'vitest'
import { assertManagedClaudeWorkerCompatible } from '../../../src/shared/sync/managedClaudeWorkerCompatibility'
import { normalizeInvokeRequest } from '../../../src/app/main/controlSurface/validate'
it.each([null, {}, { features: { managedClaudeResumeBindingV1: true } }])(
  'requires a Worker upgrade for %j',
  value => {
    expect(() => assertManagedClaudeWorkerCompatible(value)).toThrow(
      expect.objectContaining({ details: { reason: 'workerUpgradeRequired' } }),
    )
  },
)
it('accepts delivery support with release adoption off or frozen', () => {
  expect(() =>
    assertManagedClaudeWorkerCompatible({
      features: {
        managedClaudeResumeBindingDeliveryV1: true,
        managedClaudeResumeBindingV1: false,
        managedClaudeResumeBindingWritesEnabled: false,
      },
    }),
  ).not.toThrow()
})
it('validates caller declarations without upgrading older clients', () => {
  const wire = { kind: 'command', id: 'session.kill', payload: { sessionId: 'runtime' } }
  expect(normalizeInvokeRequest(wire).clientFeatures).toBeUndefined()
  expect(
    normalizeInvokeRequest({ ...wire, clientFeatures: { managedClaudeResumeBindingV1: true } })
      .clientFeatures,
  ).toEqual({ managedClaudeResumeBindingV1: true })
  expect(() =>
    normalizeInvokeRequest({ ...wire, clientFeatures: { managedClaudeResumeBindingV1: false } }),
  ).toThrow()
})
