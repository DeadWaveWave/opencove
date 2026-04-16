import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionTurnStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/SessionTurnStateWatcher'
import { afterEach, describe, expect, it } from 'vitest'

async function waitForCondition(assertion: () => void, timeoutMs = 1500): Promise<void> {
  try {
    assertion()
  } catch (error) {
    if (timeoutMs <= 0) {
      throw error
    }

    await new Promise(resolve => {
      setTimeout(resolve, Math.min(20, timeoutMs))
    })

    await waitForCondition(assertion, timeoutMs - 20)
  }
}

describe('SessionTurnStateWatcher', () => {
  const disposers: Array<() => void> = []

  afterEach(async () => {
    while (disposers.length > 0) {
      disposers.pop()?.()
    }
  })

  it('emits standby for a complete trailing final-answer record without a newline', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-watcher-'))
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [],
        },
      })}\n`,
      'utf8',
    )

    const states: string[] = []
    const watcher = new SessionTurnStateWatcher({
      provider: 'codex',
      sessionId: 'session-1',
      filePath,
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await waitForCondition(() => {
      expect(states).toEqual(['working'])
    })

    await fs.appendFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [],
        },
      }),
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working', 'standby'])
    })
  })

  it('keeps codex commentary in working until the final answer arrives', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-watcher-'))
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(filePath, '', 'utf8')

    const states: string[] = []
    const watcher = new SessionTurnStateWatcher({
      provider: 'codex',
      sessionId: 'session-2',
      filePath,
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await fs.appendFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [],
        },
      })}\n`,
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working'])
    })

    await fs.appendFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [
            {
              type: 'output_text',
              text: 'I am still working.',
            },
          ],
        },
      })}\n`,
      'utf8',
    )

    await new Promise(resolve => {
      setTimeout(resolve, 80)
    })

    expect(states).toEqual(['working'])

    await fs.appendFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call-1',
          name: 'exec_command',
          arguments: '{}',
        },
      })}\n`,
      'utf8',
    )

    await new Promise(resolve => {
      setTimeout(resolve, 80)
    })

    expect(states).toEqual(['working'])

    await fs.appendFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'Done.',
            },
          ],
        },
      }),
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working', 'standby'])
    })
  })

  it('keeps partial trailing JSON buffered until the record is complete', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-watcher-'))
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(filePath, '', 'utf8')

    const states: string[] = []
    const watcher = new SessionTurnStateWatcher({
      provider: 'codex',
      sessionId: 'session-3',
      filePath,
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await fs.appendFile(filePath, '{"type":"response_item","payload":{"type":"reasoning"', 'utf8')

    await new Promise(resolve => {
      setTimeout(resolve, 80)
    })

    expect(states).toEqual([])

    await fs.appendFile(filePath, ',"summary":[]}}', 'utf8')

    await waitForCondition(() => {
      expect(states).toEqual(['working'])
    })
  })

  it('tracks codex event-stream agent_message phases from commentary to final answer', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-watcher-'))
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(filePath, '', 'utf8')

    const states: string[] = []
    const watcher = new SessionTurnStateWatcher({
      provider: 'codex',
      sessionId: 'session-4',
      filePath,
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await fs.appendFile(
      filePath,
      `${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: 'commentary',
          message: 'I am checking the repo before making changes.',
        },
      })}\n`,
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working'])
    })

    await fs.appendFile(
      filePath,
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: 'final_answer',
          message: 'Done.',
        },
      }),
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working', 'standby'])
    })
  })

  it('re-emits standby after an explicit submit resets optimistic working state', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-watcher-'))
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'Ready.',
            },
          ],
        },
      }),
      'utf8',
    )

    const states: string[] = []
    const watcher = new SessionTurnStateWatcher({
      provider: 'codex',
      sessionId: 'session-5',
      filePath,
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await waitForCondition(() => {
      expect(states).toEqual(['standby'])
    })

    watcher.noteInteraction('\r')

    await fs.appendFile(
      filePath,
      `\n${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'Done 1.',
            },
          ],
        },
      })}`,
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['standby', 'standby'])
    })
  })
})
