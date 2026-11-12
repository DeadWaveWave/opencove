// @vitest-environment node
import { expect, it } from 'vitest'
import {
  isPromptDeliveryResult,
  normalizePromptDeliveryResult,
} from '../../../src/app/cli/core/promptTransport'

// Workers built before text evidence return an observed submission without textComparison.
const olderWorkerResult = {
  deliveryId: 'delivery',
  nodeId: 'node',
  sessionId: 'session',
  phase: 'submission_observed',
  turnId: 'turn',
}

it('accepts an older Worker success and reports its evidence as unavailable', () => {
  expect(isPromptDeliveryResult(olderWorkerResult)).toBe(true)
  expect(normalizePromptDeliveryResult(olderWorkerResult)).toEqual({
    ...olderWorkerResult,
    textComparison: 'unavailable',
    mode: 'turn',
  })
})

it('keeps evidence a current Worker sent', () => {
  const current = {
    ...olderWorkerResult,
    textComparison: 'different',
    comparisonProfile: 'claude-code-v1',
  }
  expect(normalizePromptDeliveryResult(current)).toEqual({ ...current, mode: 'turn' })
  expect(isPromptDeliveryResult({ ...olderWorkerResult, phase: 'something_else' })).toBe(false)
})
