import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { KimiWireStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/KimiWireStateWatcher'

const metadata = { type: 'metadata', protocol_version: '1.5' }
const line = (value: unknown) => `${JSON.stringify(value)}\n`

describe('KimiWireStateWatcher', () => {
  it('streams observed working and standby transitions from wire JSONL', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-wire-'))
    const filePath = join(directory, 'wire.jsonl')
    await fs.writeFile(filePath, line(metadata))
    const onState = vi.fn()
    const watcher = new KimiWireStateWatcher({
      sessionId: 'terminal-1',
      filePath,
      onState,
    })

    watcher.start()
    await fs.appendFile(filePath, line({ type: 'turn.prompt' }))
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('terminal-1', 'working'))
    await fs.appendFile(
      filePath,
      line({
        type: 'context.append_loop_event',
        event: { type: 'step.end', finishReason: 'end_turn' },
      }),
    )
    await vi.waitFor(() => expect(onState).toHaveBeenLastCalledWith('terminal-1', 'standby'))

    watcher.dispose()
    await fs.appendFile(filePath, line({ type: 'turn.prompt' }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(onState).toHaveBeenCalledTimes(2)
  })

  it('reports unsupported protocol as unobservable without fabricating standby', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-wire-'))
    const filePath = join(directory, 'wire.jsonl')
    await fs.writeFile(
      filePath,
      line({ type: 'metadata', protocol_version: '2.0' }) + line({ type: 'turn.prompt' }),
    )
    const onState = vi.fn()
    const onUnavailable = vi.fn()
    const watcher = new KimiWireStateWatcher({
      sessionId: 'terminal-2',
      filePath,
      onState,
      onUnavailable,
    })

    watcher.start()
    await vi.waitFor(() =>
      expect(onUnavailable).toHaveBeenCalledWith('terminal-2', 'protocol_unsupported'),
    )
    expect(onState).not.toHaveBeenCalled()
    watcher.dispose()
  })

  it('keeps a metadata-only session unobservable until a real turn arrives', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-wire-'))
    const filePath = join(directory, 'wire.jsonl')
    await fs.writeFile(
      filePath,
      line(metadata) + line({ type: 'permission.set_mode', mode: 'auto' }),
    )
    const onState = vi.fn()
    const onUnavailable = vi.fn()
    const watcher = new KimiWireStateWatcher({
      sessionId: 'terminal-3',
      filePath,
      onState,
      onUnavailable,
    })

    watcher.start()
    await vi.waitFor(() =>
      expect(onUnavailable).toHaveBeenCalledWith('terminal-3', 'state_unavailable'),
    )
    expect(onState).not.toHaveBeenCalled()

    await fs.appendFile(filePath, line({ type: 'turn.prompt' }))
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('terminal-3', 'working'))
    watcher.dispose()
  })

  it('withdraws a previous observation when a truncated wire has an unsupported major', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-kimi-wire-'))
    const filePath = join(directory, 'wire.jsonl')
    await fs.writeFile(filePath, line(metadata) + line({ type: 'turn.prompt' }))
    const onState = vi.fn()
    const onUnavailable = vi.fn()
    const watcher = new KimiWireStateWatcher({
      sessionId: 'terminal-4',
      filePath,
      onState,
      onUnavailable,
    })

    watcher.start()
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('terminal-4', 'working'))
    await fs.writeFile(
      filePath,
      line({ type: 'metadata', protocol_version: '2.0' }) + line({ type: 'turn.prompt' }),
    )
    await vi.waitFor(() =>
      expect(onUnavailable).toHaveBeenCalledWith('terminal-4', 'protocol_unsupported'),
    )
    expect(onState).not.toHaveBeenCalledWith('terminal-4', 'standby')
    watcher.dispose()
  })
})
