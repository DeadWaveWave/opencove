import { describe, expect, it } from 'vitest'
import { resolveMainProcessPid } from '../../../src/app/preload/mainProcessPid'

describe('resolveMainProcessPid', () => {
  it('prefers the explicit browser-process pid argument', () => {
    expect(resolveMainProcessPid(['electron', '.', '--opencove-main-process-pid=42424'], 111)).toBe(
      42424,
    )
  })

  it('falls back when the explicit pid argument is missing', () => {
    expect(resolveMainProcessPid(['electron', '.'], 222)).toBe(222)
  })

  it('falls back when the explicit pid argument is invalid', () => {
    expect(
      resolveMainProcessPid(['electron', '.', '--opencove-main-process-pid=not-a-number'], 333),
    ).toBe(333)
  })
})
