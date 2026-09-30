// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginWindowCommands } from '../../../../src/contexts/plugins/application/PluginWindowCommands'

function setup() {
  let id = 0
  const commands = new PluginWindowCommands(() => String(++id), 30_000)
  const send = vi.fn()
  const connection = commands.connect('view', send)
  const ready = () => connection.receive({ type: 'ready', protocol: 2, ready: true })
  const result = (value: unknown, requestId = '1') =>
    connection.receive({ type: 'result', protocol: 2, requestId, ok: true, value })
  return { commands, send, connection, ready, result }
}

afterEach(() => vi.useRealTimers())

describe('plugin window command routing', () => {
  it('waits for handler readiness and delivers once to exactly the selected view', async () => {
    const { commands, send, ready, result } = setup()
    const other = commands.connect('other', vi.fn())
    other.receive({ type: 'ready', protocol: 2, ready: true })
    expect(commands.isReady('view')).toBe(false)
    await expect(commands.run('view', 'update', null)).rejects.toThrow('not ready')
    ready()
    expect(commands.isReady('view')).toBe(true)
    const work = commands.run('view', 'update', { amount: 2 })
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'command',
      protocol: 2,
      requestId: '1',
      commandId: 'update',
      params: { amount: 2 },
    })
    other.receive({ type: 'result', protocol: 2, requestId: '1', ok: true, value: 'wrong view' })
    result({ applied: 2 })
    await expect(work).resolves.toEqual({ applied: 2 })
    result('late duplicate')
    commands.retire('view')
    commands.retire('other')
  })

  it('refuses ambiguous ready documents without broadcasting or guessing', async () => {
    const { commands, send, ready, connection } = setup()
    ready()
    const secondSend = vi.fn()
    const second = commands.connect('view', secondSend)
    second.receive({ type: 'ready', protocol: 2, ready: true })
    expect(commands.isReady('view')).toBe(false)
    await expect(commands.run('view', 'update', null)).rejects.toThrow('multiple ready')
    expect(send).not.toHaveBeenCalled()
    expect(secondSend).not.toHaveBeenCalled()
    second.dispose()
    expect(commands.isReady('view')).toBe(true)
    connection.receive({ type: 'ready', protocol: 2, ready: false })
    expect(commands.isReady('view')).toBe(false)
  })

  it('rejects disconnected calls and never replays them after reconnect', async () => {
    const { commands, ready, connection } = setup()
    ready()
    const pending = commands.run('view', 'update', null)
    const failure = expect(pending).rejects.toThrow('disconnected')
    connection.dispose()
    await failure
    const replacementSend = vi.fn()
    const replacement = commands.connect('view', replacementSend)
    replacement.receive({ type: 'ready', protocol: 2, ready: true })
    connection.receive({ type: 'result', protocol: 2, requestId: '1', ok: true, value: 'old' })
    expect(replacementSend).not.toHaveBeenCalled()
    const current = commands.run('view', 'update', null)
    const retired = expect(current).rejects.toThrow('disconnected')
    commands.retire('view')
    await retired
    expect(commands.isReady('view')).toBe(false)
    replacement.dispose()
  })

  it('times out once, ignores late replies and preserves handler errors', async () => {
    vi.useFakeTimers()
    const { commands, ready, result, send, connection } = setup()
    ready()
    const pending = commands.run('view', 'update', null)
    const failure = expect(pending).rejects.toThrow('not retried')
    await vi.advanceTimersByTimeAsync(30_000)
    await failure
    result('too late')
    expect(send).toHaveBeenCalledOnce()
    const next = commands.run('view', 'update', null)
    connection.receive({
      type: 'result',
      protocol: 2,
      requestId: '2',
      ok: false,
      error: 'Unavailable',
    })
    await expect(next).rejects.toThrow('Unavailable')
    commands.retire('view')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects non-JSON and oversized payloads before sending, and malformed replies at the boundary', async () => {
    const { commands, ready, connection, send, result } = setup()
    ready()
    await Promise.all(
      [{ value: NaN }, { callback: () => {} }, 'x'.repeat(1024 * 1024)].map(params =>
        expect(commands.run('view', 'update', params)).rejects.toThrow(),
      ),
    )
    expect(send).not.toHaveBeenCalled()
    expect(() => connection.receive({ type: 'ready', protocol: 1, ready: true })).toThrow(
      'protocol',
    )
    expect(() => connection.receive({ type: 'ready', protocol: 2, ready: 'yes' })).toThrow()
    const pending = commands.run('view', 'update', null)
    const requestId = send.mock.calls[0][0].requestId
    expect(() => result('x'.repeat(2 * 1024 * 1024), requestId)).toThrow('too large')
    expect(() => connection.receive({ type: 'result', protocol: 2, requestId, ok: true })).toThrow(
      'value',
    )
    result(null, requestId)
    await expect(pending).resolves.toBeNull()
    commands.retire('view')
  })

  it('releases pending state if sending fails synchronously', async () => {
    vi.useFakeTimers()
    const { commands, send, ready } = setup()
    ready()
    send.mockImplementation(() => {
      throw new Error('Socket closed')
    })
    await expect(commands.run('view', 'update', null)).rejects.toThrow('Socket closed')
    expect(vi.getTimerCount()).toBe(0)
    commands.retire('view')
  })

  it('normalizes an omitted argument to null without changing nested JSON semantics', async () => {
    const { commands, send, ready, result } = setup()
    ready()
    const pending = commands.run('view', 'update', undefined)
    expect(send.mock.calls[0][0].params).toBeNull()
    result(null)
    await expect(pending).resolves.toBeNull()
    commands.retire('view')
  })
})
