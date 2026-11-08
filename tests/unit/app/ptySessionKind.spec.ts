import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/opencove-reap-test' },
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
afterEach(() => vi.resetModules())

describe('managed Agent kind at the process boundary', () => {
  it.each(['local', 'worker'] as const)(
    'propagates managed ownership and preserves plain shells in %s',
    async mode => {
      const engine = new FakeTerminalProcessEngine()
      let count = 0
      engine.spawn.mockImplementation(async () => ({ sessionId: `session-${++count}` }))
      const runtime =
        mode === 'local'
          ? (
              await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
            ).createPtyRuntime({ processEngine: engine })
          : (await import('../../../src/app/worker/headlessPtyRuntime')).createHeadlessPtyRuntime({
              processEngine: engine,
            })
      const base = { cwd: '/tmp', command: 'codex', args: [], cols: 80, rows: 24 }
      await runtime.spawnSession({ ...base, agentProvider: 'codex' })
      expect(engine.spawn).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionKind: 'agent' }),
      )
      // A manually launched Codex command in a terminal does not grant managed ownership.
      await runtime.spawnSession(base)
      expect(engine.spawn.mock.calls.at(-1)![0].sessionKind ?? 'shell').toBe('shell')
      await runtime.dispose()
    },
  )
})
