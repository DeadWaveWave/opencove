import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}))

function createChildProcessMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.kill = vi.fn(() => true)
  return child
}

describe('runCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    spawnMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gracefully terminates, escalates, and waits for close on timeout', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('git', ['status'], '/repo', {
      timeoutMs: 100,
      timeoutGraceMs: 50,
    })
    const rejection = vi.fn()
    void resultPromise.catch(rejection)

    await vi.advanceTimersByTimeAsync(100)
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(rejection).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(50)
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    expect(rejection).not.toHaveBeenCalled()

    child.emit('close', null, 'SIGKILL')
    await expect(resultPromise).rejects.toThrow('git command timed out')
  })

  it('supports commands without a timeout', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('git', ['worktree', 'add'], '/repo', {
      timeoutMs: null,
    })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(child.kill).not.toHaveBeenCalled()

    child.emit('close', 0, null)
    await expect(resultPromise).resolves.toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
  })

  it('cancels force kill when graceful termination closes the process', async () => {
    const child = createChildProcessMock()
    child.kill.mockImplementation(signal => {
      if (signal === 'SIGTERM') {
        child.emit('close', null, 'SIGTERM')
      }
      return true
    })
    spawnMock.mockReturnValue(child)
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('git', ['status'], '/repo', {
      timeoutMs: 100,
      timeoutGraceMs: 50,
    })
    const resultExpectation = expect(resultPromise).rejects.toThrow('git command timed out')

    await vi.advanceTimersByTimeAsync(100)
    await resultExpectation
    await vi.advanceTimersByTimeAsync(50)

    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
