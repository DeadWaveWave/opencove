// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { PTY_HOST_PROTOCOL_VERSION } from '@platform/process/ptyHost/protocol'

const state = vi.hoisted(() => ({
  parent: null as EventEmitter | null,
  send: vi.fn(),
  connected: true,
  stderr: { write: vi.fn() },
  exit: vi.fn(),
  kill: vi.fn(),
  rootPid: 10,
  data: null as ((data: string) => void) | null,
  onExit: null as ((exit: { exitCode: number }) => void) | null,
  rows: '10 1 10 Mon Nov 9 12:00:00 2026 S node\n20 10 20 Mon Nov 9 12:00:01 2026 S sleep\n',
}))
vi.mock('node:process', () => ({
  default: {
    kill: (pid: number, signal: NodeJS.Signals) => process.kill(pid, signal),
    platform: 'darwin',
    env: {},
    send: state.send,
    get connected() {
      return state.connected
    },
    stderr: state.stderr,
    on: (event: string, listener: (...args: unknown[]) => void) =>
      state.parent!.on(event, listener),
    once: (event: string, listener: (...args: unknown[]) => void) =>
      state.parent!.once(event, listener),
    exit: state.exit,
  },
}))
vi.mock('node:worker_threads', () => ({ parentPort: null }))
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void
    const rows = state.rows
    queueMicrotask(() => callback(null, rows, ''))
    return {}
  },
  spawnSync: vi.fn(),
}))
vi.mock('node-pty', () => ({
  spawn: () => {
    const pid = state.rootPid
    return {
      pid,
      kill: () => state.kill(pid),
      onData: (listener: (data: string) => void) => {
        state.data = listener
      },
      onExit: (listener: (exit: { exitCode: number }) => void) => {
        state.onExit = listener
      },
    }
  },
}))
vi.mock('@platform/process/ptyHost/spawnHelperPermissions', () => ({
  ensureNodePtySpawnHelperExecutable: () => undefined,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.resetModules()
})

async function host(kind: 'agent' | 'shell') {
  vi.useFakeTimers()
  state.parent = new EventEmitter()
  state.send.mockReset()
  state.connected = true
  state.stderr.write.mockClear()
  state.exit.mockClear()
  state.kill.mockReset()
  state.rootPid = 10
  state.rows = '10 1 10 Mon Nov 9 12:00:00 2026 S node\n20 10 20 Mon Nov 9 12:00:01 2026 S sleep\n'
  const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
  await import('@platform/process/ptyHost/entry')
  const ready = state.send.mock.calls[0]![0] as { hostInstanceId: string; protocolVersion: number }
  expect(ready.protocolVersion).toBe(PTY_HOST_PROTOCOL_VERSION)
  const send = (message: Record<string, unknown>) =>
    state.parent!.emit('message', { hostInstanceId: ready.hostInstanceId, ...message })
  send({
    type: 'spawn',
    requestId: 'r',
    launchId: 'l',
    sessionKind: kind,
    command: 'fixture',
    args: [],
    cwd: '/tmp',
    env: {},
    cols: 80,
    rows: 24,
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(state.exit).not.toHaveBeenCalled()
  const response = state.send.mock.calls.find(([value]) => value.type === 'response')![0]
  return { send, signal, sessionId: response.result.sessionId as string }
}

it.each(['shutdown', 'disconnect', 'SIGTERM'] as const)(
  'drains Agent snapshot before host %s completes',
  async mode => {
    const h = await host('agent')
    if (mode === 'shutdown') {
      h.send({ type: 'shutdown' })
    } else {
      state.parent!.emit(mode)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(state.kill).toHaveBeenCalledOnce()
    expect(state.exit).not.toHaveBeenCalled()
    state.rows = '20 1 20 Mon Nov 9 12:00:01 2026 S sleep\n'
    await vi.runAllTimersAsync()
    expect(h.signal.mock.calls).toEqual([
      [20, 'SIGTERM'],
      [20, 'SIGKILL'],
    ])
    expect(state.exit).toHaveBeenCalledExactlyOnceWith(0)
  },
)
it('retains an explicitly closed Agent cleanup through root exit and shutdown; duplicate kill is harmless', async () => {
  const h = await host('agent')
  h.send({ type: 'kill', sessionId: h.sessionId })
  h.send({ type: 'kill', sessionId: h.sessionId })
  await vi.advanceTimersByTimeAsync(0)
  state.onExit?.({ exitCode: 0 })
  h.send({ type: 'shutdown' })
  expect(state.kill).toHaveBeenCalledOnce()
  expect(state.exit).not.toHaveBeenCalled()
  state.rows = '20 1 20 Mon Nov 9 12:00:01 2026 S sleep\n'
  await vi.runAllTimersAsync()
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
  expect(state.exit).toHaveBeenCalledExactlyOnceWith(0)
})
it('keeps ownership on natural exit and reaps only when the exited window is later closed', async () => {
  const h = await host('agent')
  state.onExit?.({ exitCode: 0 })
  state.rows = '20 1 20 Mon Nov 9 12:00:01 2026 S sleep\n'
  await vi.advanceTimersByTimeAsync(5_000)
  expect(h.signal).not.toHaveBeenCalled()
  h.send({ type: 'kill', sessionId: h.sessionId })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(state.kill).not.toHaveBeenCalled()
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
  h.send({ type: 'shutdown' })
  await vi.runAllTimersAsync()
})

it('keeps shell hangup without descendant escalation', async () => {
  const h = await host('shell')
  h.send({ type: 'kill', sessionId: h.sessionId })
  await vi.runAllTimersAsync()
  expect(state.kill).toHaveBeenCalledOnce()
  expect(h.signal).not.toHaveBeenCalled()
})

it.each(['disconnected', 'send-race'] as const)(
  'disconnect survives async IPC %s errors until all Agent retirement stages finish',
  async mode => {
    const h = await host('agent')
    const fatalErrors: Error[] = []
    // Node emits an unhandled error instead of calling a missing send callback.
    // Model its process-exit effect without crashing the Vitest worker itself.
    state.send.mockImplementation((_message: unknown, callback?: (error: Error) => void) => {
      const error = Object.assign(new Error('Channel closed'), { code: 'ERR_IPC_CHANNEL_CLOSED' })
      queueMicrotask(() => {
        if (callback) {
          callback(error)
        } else {
          fatalErrors.push(error)
          state.exit(1)
        }
      })
    })
    state.kill.mockImplementation(() => {
      state.rows = '20 1 20 Mon Nov 9 12:00:01 2026 S sleep\n'
      state.onExit?.({ exitCode: 0 })
      state.data?.('trailing output')
    })
    // send-race keeps the connected getter true while the real send already fails.
    state.connected = mode === 'send-race'
    state.parent!.emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.kill).toHaveBeenCalledOnce()
    expect(fatalErrors).toEqual([])
    expect(state.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(h.signal).toHaveBeenCalledWith(20, 'SIGTERM')
    expect(state.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
    expect(state.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(vi.getTimerCount()).toBe(0)
  },
)
it('disconnect has a referenced overall deadline even when the retirement drain never settles', async () => {
  await host('agent')
  const { AgentProcessReaper } = await import('@platform/process/ptyHost/agentProcessReaper')
  vi.spyOn(AgentProcessReaper.prototype, 'drain').mockImplementation(() => new Promise(() => {}))
  state.connected = false
  const setTimer = vi.spyOn(globalThis, 'setTimeout')
  state.parent!.emit('disconnect')
  const deadline = setTimer.mock.results[0]!.value as NodeJS.Timeout
  expect(deadline.hasRef()).toBe(true)
  await vi.advanceTimersByTimeAsync(3_999)
  expect(state.exit).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(state.exit).toHaveBeenCalledExactlyOnceWith(1)
  expect(state.stderr.write).toHaveBeenCalledWith(expect.stringContaining('shutdown deadline'))
})

it('disconnect drains every Agent session together before exiting', async () => {
  const h = await host('agent')
  state.rootPid = 100
  state.rows +=
    '100 1 100 Mon Nov 9 12:00:02 2026 S node\n200 100 200 Mon Nov 9 12:00:03 2026 S sleep\n'
  h.send({
    type: 'spawn',
    requestId: 'second',
    launchId: 'second',
    sessionKind: 'agent',
    command: 'fixture',
    args: [],
    cwd: '/tmp',
    env: {},
    cols: 80,
    rows: 24,
  })
  await vi.advanceTimersByTimeAsync(0)
  state.connected = false
  state.kill.mockImplementation(() => {
    state.rows =
      '20 1 20 Mon Nov 9 12:00:01 2026 S sleep\n200 1 200 Mon Nov 9 12:00:03 2026 S sleep\n'
  })
  state.parent!.emit('disconnect')
  await vi.advanceTimersByTimeAsync(0)
  expect(state.kill.mock.calls.map(([pid]) => pid)).toEqual([10, 100])
  await vi.advanceTimersByTimeAsync(150)
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGTERM')
  expect(h.signal).toHaveBeenCalledWith(200, 'SIGTERM')
  expect(state.exit).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  expect(h.signal).toHaveBeenCalledWith(20, 'SIGKILL')
  expect(h.signal).toHaveBeenCalledWith(200, 'SIGKILL')
  expect(state.exit).toHaveBeenCalledExactlyOnceWith(0)
})
