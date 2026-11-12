import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNodeCliIo } from '../../../src/app/cli/core/io'
import { isProcessAlive } from '../../../src/app/cli/workerLifecycle.mjs'

function killThrowing(code: string) {
  return vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error(code), { code })
  })
}

describe.each([
  ['CLI core io', (pid: number) => createNodeCliIo().isProcessAlive(pid)],
  ['worker lifecycle', (pid: number) => isProcessAlive(pid)],
])('%s process liveness', (_name, alive) => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats a process it may not signal (EPERM) as alive', () => {
    killThrowing('EPERM')
    expect(alive(4242)).toBe(true)
  })

  it('treats a missing process (ESRCH) as not alive', () => {
    killThrowing('ESRCH')
    expect(alive(4242)).toBe(false)
  })

  it('rejects invalid pids without signaling', () => {
    const kill = vi.spyOn(process, 'kill')
    expect(alive(0)).toBe(false)
    expect(alive(-1)).toBe(false)
    expect(alive(Number.NaN)).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })
})
