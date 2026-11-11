// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { spawnHostSession } from '../../../src/platform/process/ptyHost/spawn'
import { PtyHostExitEvidence } from '../../../src/platform/process/ptyHost/hostExitEvidence'
import { physicalSpawnLifecycle } from '../../../src/shared/runtime/physicalSpawnLifecycle'
import type { PtyHostProcess } from '../../../src/platform/process/ptyHost/processTypes'
const input = { command: 'fixture', args: [], cwd: '/repo', cols: 80, rows: 24 }
function fixture() {
  const child = {} as PtyHostProcess,
    exitEvidence = new PtyHostExitEvidence()
  const request = vi.fn(async () => {
    throw new Error('response lost')
  })
  const deps = {
    ensureReady: async () => {},
    process: () => child,
    hostInstanceId: () => 'host',
    isDisposed: () => false,
    timeoutMs: 50,
    exitEvidence,
    request,
  }
  const observer = {
    singleAttempt: true,
    beforeDispatch: vi.fn(),
    started: vi.fn(),
    completed: vi.fn(),
    unknown: vi.fn<(completion: Promise<void>) => void>(),
  }
  return { child, exitEvidence, request, deps, observer }
}
it('checks activity again after ensureReady and before Worker dispatch', async () => {
  const f = fixture()
  let active = true
  f.deps.ensureReady = async () => {
    active = false
  }
  f.observer.beforeDispatch.mockImplementation(() => {
    if (!active) {
      throw new Error('revoked')
    }
  })
  await expect(
    physicalSpawnLifecycle.run(f.observer, () => spawnHostSession(input, f.deps)),
  ).rejects.toThrow('revoked')
  expect(f.request).not.toHaveBeenCalled()
  expect(f.observer.unknown).not.toHaveBeenCalled()
})
it('resolves an unknown dispatch only when the exact host confirms completion', async () => {
  const f = fixture()
  await expect(
    physicalSpawnLifecycle.run(f.observer, () => spawnHostSession(input, f.deps)),
  ).rejects.toThrow('response lost')
  expect(f.request).toHaveBeenCalledOnce()
  expect(f.observer.unknown).toHaveBeenCalledOnce()
  let resolved = false
  const completion = f.observer.unknown.mock.calls[0][0] as Promise<void>
  void completion.then(() => {
    resolved = true
  })
  f.exitEvidence.confirmExit({} as PtyHostProcess, 0)
  await Promise.resolve()
  expect(resolved).toBe(false)
  f.exitEvidence.confirmExit(f.child, 0)
  await completion
  expect(resolved).toBe(true)
})
it('keeps a known host refusal as not-started rather than unknown', async () => {
  const f = fixture()
  const request = vi.fn(async () => ({
    ok: false as const,
    requestType: 'spawn' as const,
    error: { message: 'not started' },
  }))
  await expect(
    physicalSpawnLifecycle.run(f.observer, () =>
      spawnHostSession(input, { ...f.deps, request: request as never }),
    ),
  ).rejects.toThrow('not started')
  expect(f.observer.unknown).not.toHaveBeenCalled()
})
