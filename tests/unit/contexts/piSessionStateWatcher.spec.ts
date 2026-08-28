import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PiSessionStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/PiSessionStateWatcher'

const header = {
  type: 'session',
  version: 3,
  id: 'session-redacted',
  cwd: '/workspace',
}
const line = (value: unknown) => `${JSON.stringify(value)}\n`

describe('PiSessionStateWatcher', () => {
  it('streams working through a toolResult and reaches standby on final assistant output', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-session-'))
    const filePath = join(directory, 'session.jsonl')
    await fs.writeFile(filePath, line(header))
    const onState = vi.fn()
    const watcher = new PiSessionStateWatcher({
      sessionId: 'terminal-pi',
      filePath,
      onState,
    })

    watcher.start()
    await fs.appendFile(filePath, line({ type: 'message', message: { role: 'user' } }))
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith('terminal-pi', 'working'))

    await fs.appendFile(
      filePath,
      line({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall' }],
          stopReason: 'toolUse',
        },
      }) + line({ type: 'message', message: { role: 'toolResult', isError: false } }),
    )
    await fs.appendFile(
      filePath,
      line({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '<redacted>' }],
          stopReason: 'stop',
        },
      }),
    )
    await vi.waitFor(() => expect(onState).toHaveBeenLastCalledWith('terminal-pi', 'standby'))
    expect(onState.mock.calls).toEqual([
      ['terminal-pi', 'working'],
      ['terminal-pi', 'standby'],
    ])

    watcher.dispose()
  })
})
