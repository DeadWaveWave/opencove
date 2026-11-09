// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { observedProcessAlive } from '../../support/processLiveness'

const identity = { pid: 20, startTime: 'birth-20' }
it('does not turn a missing row in a partial sample into proof of death', () => {
  expect(observedProcessAlive(identity, new Map(), false, vi.fn())).toBe('unknown')
})
it('confirms absence from ESRCH even when an unrelated row made ps incomplete', () => {
  expect(
    observedProcessAlive(identity, new Map(), false, () => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    }),
  ).toBe(false)
})
it('accepts complete absence and identity changes without probing another PID incarnation', () => {
  const probe = vi.fn()
  expect(observedProcessAlive(identity, new Map(), true, probe)).toBe(false)
  expect(observedProcessAlive(identity, new Map([[20, 'replacement']]), false, probe)).toBe(false)
  expect(probe).not.toHaveBeenCalled()
})
it('recognizes the validated member in a partial sample', () => {
  expect(observedProcessAlive(identity, new Map([[20, 'birth-20']]), false, vi.fn())).toBe(true)
})
it('does not hide unexpected liveness probe errors', () => {
  expect(() =>
    observedProcessAlive(identity, new Map(), false, () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    }),
  ).toThrow('denied')
})
