import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

afterEach(() => {
  vi.doUnmock('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine')
  vi.resetModules()
})

describe('PTY runtime dependency injection', () => {
  it('uses an injected engine without importing infrastructure and owns main cleanup once', async () => {
    vi.doMock('electron', () => ({
      app: { getPath: vi.fn(() => '/tmp/opencove-user-data') },
      utilityProcess: { fork: vi.fn() },
      webContents: {
        getAllWebContents: () => [],
        fromId: () => null,
      },
    }))
    vi.doMock('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine', () => {
      throw new Error('runtime imported terminal infrastructure')
    })

    const processEngine = new FakeTerminalProcessEngine()
    const { createPtyRuntime } =
      await import('../../../src/contexts/terminal/presentation/main-ipc/runtime')
    const runtime = createPtyRuntime({ processEngine })

    runtime.dispose()
    runtime.dispose()

    expect(processEngine.disposedSubscriptions.data).toHaveBeenCalledTimes(1)
    expect(processEngine.disposedSubscriptions.exit).toHaveBeenCalledTimes(1)
    expect(processEngine.disposedSubscriptions.foreground).toHaveBeenCalledTimes(1)
    expect(processEngine.dispose).toHaveBeenCalledTimes(1)
    expect(processEngine.disposedSubscriptions.data.mock.invocationCallOrder[0]).toBeLessThan(
      processEngine.dispose.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('uses an injected engine without importing infrastructure and owns headless cleanup once', async () => {
    vi.doMock('../../../src/contexts/terminal/infrastructure/PtyHostTerminalProcessEngine', () => {
      throw new Error('runtime imported terminal infrastructure')
    })

    const processEngine = new FakeTerminalProcessEngine()
    const { createHeadlessPtyRuntime } = await import('../../../src/app/worker/headlessPtyRuntime')
    const runtime = createHeadlessPtyRuntime({ processEngine })

    runtime.dispose()
    runtime.dispose()

    expect(processEngine.disposedSubscriptions.data).toHaveBeenCalledTimes(1)
    expect(processEngine.disposedSubscriptions.exit).toHaveBeenCalledTimes(1)
    expect(processEngine.disposedSubscriptions.foreground).toHaveBeenCalledTimes(1)
    expect(processEngine.dispose).toHaveBeenCalledTimes(1)
    expect(processEngine.disposedSubscriptions.data.mock.invocationCallOrder[0]).toBeLessThan(
      processEngine.dispose.mock.invocationCallOrder[0] ?? 0,
    )
  })
})
