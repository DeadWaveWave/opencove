import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLastAssistantMessageFromSessionFile } from '../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { afterEach, describe, expect, it } from 'vitest'

describe('readLastAssistantMessageFromSessionFile', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(directory => {
        return fs.rm(directory, { recursive: true, force: true })
      }),
    )
  })

  it('extracts a trailing codex final answer without a newline', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [],
        },
      })}\n${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            {
              type: 'output_text',
              text: 'All set.',
            },
          ],
        },
      })}`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('codex', filePath)).resolves.toBe(
      'All set.',
    )
  })

  it('ignores an incomplete trailing record and keeps the last complete codex message', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: 'final_answer',
          message: 'Stable answer',
        },
      })}\n{"type":"response_item","payload":{"type":"message"`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('codex', filePath)).resolves.toBe(
      'Stable answer',
    )
  })

  it('extracts the last claude assistant text block', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cove-session-message-'))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, 'session.jsonl')

    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: null,
          content: [
            {
              type: 'thinking',
              thinking: 'Working...',
            },
          ],
        },
      })}\n${JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: 'Summarized note content',
            },
          ],
        },
      })}`,
      'utf8',
    )

    await expect(readLastAssistantMessageFromSessionFile('claude-code', filePath)).resolves.toBe(
      'Summarized note content',
    )
  })
})
