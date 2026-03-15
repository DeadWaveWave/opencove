import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GeminiSessionStateWatcher } from '../../../src/contexts/agent/infrastructure/watchers/GeminiSessionStateWatcher'

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

function createGeminiSessionFile(
  messages: Array<{ type: 'user' | 'gemini' | 'info'; content?: unknown }>,
) {
  return JSON.stringify({
    sessionId: 'gemini-session-1',
    startTime: '2026-03-15T08:00:00.000Z',
    lastUpdated: '2026-03-15T08:00:05.000Z',
    messages,
    kind: 'main',
  })
}

describe('GeminiSessionStateWatcher', () => {
  const disposers: Array<() => void> = []

  afterEach(async () => {
    while (disposers.length > 0) {
      disposers.pop()?.()
    }
  })

  it('ignores non-turn info messages and only reacts when user and gemini messages land', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-gemini-session-watcher-'))
    const filePath = join(tempDir, 'session.json')

    await fs.writeFile(
      filePath,
      createGeminiSessionFile([
        {
          type: 'info',
          content: 'Gemini CLI update available',
        },
      ]),
      'utf8',
    )

    const states: string[] = []
    const watcher = new GeminiSessionStateWatcher({
      sessionId: 'session-1',
      filePath,
      launchMode: 'new',
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await new Promise(resolve => {
      setTimeout(resolve, 120)
    })

    expect(states).toEqual([])

    await fs.writeFile(
      filePath,
      createGeminiSessionFile([
        {
          type: 'info',
          content: 'Gemini CLI update available',
        },
        { type: 'user', content: [{ text: 'hello' }] },
      ]),
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working'])
    })

    await fs.writeFile(
      filePath,
      createGeminiSessionFile([
        {
          type: 'info',
          content: 'Gemini CLI update available',
        },
        { type: 'user', content: [{ text: 'hello' }] },
        { type: 'gemini', content: 'done' },
      ]),
      'utf8',
    )

    await waitForCondition(() => {
      expect(states).toEqual(['working', 'standby'])
    })
  })

  it('starts resumed sessions in standby when the latest durable turn is already complete', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-gemini-session-watcher-'))
    const filePath = join(tempDir, 'session.json')

    await fs.writeFile(
      filePath,
      createGeminiSessionFile([
        { type: 'user', content: [{ text: 'hello' }] },
        { type: 'gemini', content: 'done' },
      ]),
      'utf8',
    )

    const states: string[] = []
    const watcher = new GeminiSessionStateWatcher({
      sessionId: 'session-2',
      filePath,
      launchMode: 'resume',
      onState: (_sessionId, state) => {
        states.push(state)
      },
    })

    disposers.push(() => watcher.dispose())
    watcher.start()

    await waitForCondition(() => {
      expect(states).toEqual(['standby'])
    })
  })
})
