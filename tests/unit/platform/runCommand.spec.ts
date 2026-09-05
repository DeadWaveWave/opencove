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

  it('observes chunks without surrendering buffered output or completion ownership', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const stdoutObserver = vi.fn(() => {
      throw new Error('observer failures are isolated')
    })
    const stderrObserver = vi.fn()
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('ssh', [], '/repo', {
      onStdout: stdoutObserver,
      onStderr: stderrObserver,
    })
    child.stdout.emit('data', Buffer.from('phase-one\n'))
    child.stderr.emit('data', Buffer.from('diagnostic\n'))

    expect(stdoutObserver).toHaveBeenCalledWith('phase-one\n')
    expect(stderrObserver).toHaveBeenCalledWith('diagnostic\n')
    child.emit('close', 0, null)

    await expect(resultPromise).resolves.toEqual({
      exitCode: 0,
      stdout: 'phase-one\n',
      stderr: 'diagnostic\n',
    })
  })

  it('uses the bounded termination path and settles abort only after close', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('ssh', [], '/repo', {
      signal: controller.signal,
      timeoutMs: null,
      timeoutGraceMs: 50,
    })
    const rejection = vi.fn()
    void resultPromise.catch(rejection)

    controller.abort()
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(rejection).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(50)
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    child.emit('close', null, 'SIGKILL')

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('does not spawn when the supplied signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    await expect(
      runCommand('ssh', [], '/repo', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('retains a UTF-8-safe bounded tail while observers receive the complete stream', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const observed: string[] = []
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('ssh', [], '/repo', {
      captureMaxBytes: 8,
      onStdout: chunk => observed.push(chunk),
    })
    child.stdout.emit('data', Buffer.from('prefix🙂tail', 'utf8'))
    child.emit('close', 0, null)

    const result = await resultPromise
    expect(observed).toEqual(['prefix🙂tail'])
    expect(result.stdout).toBe('[output truncated]\n🙂tail')
    expect(result.stdout).not.toContain('�')
  })

  it('preserves unlimited output by default', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('ssh', [], '/repo')
    child.stdout.emit('data', Buffer.from('first'))
    child.stdout.emit('data', Buffer.from(' second'))
    child.emit('close', 0, null)

    await expect(resultPromise).resolves.toMatchObject({ stdout: 'first second' })
  })

  it('keeps the first termination reason across timeout/abort/error races', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const controller = new AbortController()
    const { runCommand } = await import('../../../src/platform/process/runCommand')
    const result = runCommand('ssh', [], '/repo', {
      signal: controller.signal,
      timeoutMs: 100,
      timeoutGraceMs: 50,
    })
    const rejected = vi.fn()
    void result.catch(rejected)
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    child.emit('error', new Error('kill raced close'))
    expect(rejected).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
    child.emit('close', null)
    await expect(result).rejects.toThrow('ssh command timed out')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('observes close when abort races spawn setup and terminates synchronously', async () => {
    const child = createChildProcessMock()
    const controller = new AbortController()
    spawnMock.mockImplementation(() => {
      controller.abort()
      return child
    })
    child.kill.mockImplementation(() => {
      child.emit('close', null)
      return true
    })
    const { runCommand } = await import('../../../src/platform/process/runCommand')
    const result = runCommand('ssh', [], '/repo', { signal: controller.signal })
    const rejected = vi.fn()
    void result.catch(rejected)
    await Promise.resolve()
    await Promise.resolve()
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }))
    expect(child.stdin.write).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps bounded UTF-8 output intact across split multibyte chunks', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const { runCommand } = await import('../../../src/platform/process/runCommand')
    const result = runCommand('ssh', [], '/repo', { captureMaxBytes: 5 })
    const bytes = Buffer.from('prefix🙂X')
    child.stdout.emit('data', bytes.subarray(0, 8))
    child.stdout.emit('data', bytes.subarray(8))
    child.emit('close', 0)
    await expect(result).resolves.toMatchObject({ stdout: '[output truncated]\n🙂X' })
  })

  it('settles only once when process error and close both arrive', async () => {
    const child = createChildProcessMock()
    spawnMock.mockReturnValue(child)
    const { runCommand } = await import('../../../src/platform/process/runCommand')

    const resultPromise = runCommand('missing-command', [], '/repo')
    const error = new Error('spawn ENOENT')
    child.emit('error', error)
    child.emit('close', -2, null)

    await expect(resultPromise).rejects.toBe(error)
  })
})
