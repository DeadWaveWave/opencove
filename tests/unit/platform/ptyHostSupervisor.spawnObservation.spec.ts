// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { PtyHostSupervisor } from '../../../src/platform/process/ptyHost/supervisor'
import { physicalSpawnLifecycle } from '../../../src/shared/runtime/physicalSpawnLifecycle'
import { TestPtyHostProcess } from './ptyHostSupervisor.testSupport'

it('resolves unknown occupancy on the exact host exit even after supervisor disposal begins', async () => {
  const host = new TestPtyHostProcess()
  host.exitOnKill = false
  const supervisor = new PtyHostSupervisor({
    baseDir: '/',
    resolveEntryPath: () => '/fake/ptyHost.js',
    createProcess: () => host,
    spawnTimeoutMs: 5,
    reportIssue: () => {},
  })
  const observer = {
    singleAttempt: true,
    beforeDispatch: () => {},
    started: () => {},
    completed: () => {},
    unknown: vi.fn<(completion: Promise<void>) => void>(),
  }
  try {
    const spawning = physicalSpawnLifecycle.run(observer, () =>
      supervisor.spawn({ command: 'fixture', args: [], cwd: '/', cols: 80, rows: 24 }),
    )
    host.emitReady()
    await expect(spawning).rejects.toThrow('spawn timeout')
    expect(observer.unknown).toHaveBeenCalledOnce()
    let completed = false
    void observer.unknown.mock.calls[0][0].then(() => {
      completed = true
    })
    const disposal = supervisor.dispose()
    await Promise.resolve()
    expect(completed).toBe(false)
    host.emit('exit', 0)
    await disposal
    await Promise.resolve()
    expect(completed).toBe(true)
  } finally {
    host.emit('exit', 0)
    await supervisor.dispose()
  }
})
