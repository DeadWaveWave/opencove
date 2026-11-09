// @vitest-environment node
import { expect, it } from 'vitest'
import { sessionStopNodeOperation as operation } from '../../../src/shared/contracts/controlSurface/operations/domains/session'

it('preserves the explicit agent-only request through wire normalization', () => {
  const input = { nodeId: 'node', sessionId: 'session', agentOnly: true }
  expect(operation.normalize(operation.input.parse(input))).toEqual(input)
  expect(operation.legacyNormalize!(input)).toEqual(input)
  expect(operation.scope).toBe('interact')
})

it.each([false, 'true', null, 1])('rejects invalid agentOnly %j', agentOnly => {
  const input = { nodeId: 'node', sessionId: 'session', agentOnly }
  expect(operation.input.safeParse(input).success).toBe(false)
  expect(() => operation.legacyNormalize!(input)).toThrow()
})

it('keeps the generic node-stop input compatible', () => {
  const input = { nodeId: 'node', sessionId: 'session' }
  expect(operation.normalize(operation.input.parse(input))).toEqual(input)
})
