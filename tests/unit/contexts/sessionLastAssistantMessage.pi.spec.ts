import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLastAssistantMessageFromSessionFile } from '../../../src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })),
  )
})

function message(id: string, parentId: string | null, content: unknown[], stopReason = 'stop') {
  return { type: 'message', id, parentId, message: { role: 'assistant', content, stopReason } }
}

function reply(id: string, parentId: string | null, text: string) {
  return message(id, parentId, [{ type: 'text', text }])
}

async function readSession(records: unknown[], suffix = '', version = 3) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'opencove-pi-message-'))
  directories.push(directory)
  const filePath = join(directory, 'session.jsonl')
  const header = {
    type: 'session',
    version,
    id: 'pi-message-session',
    cwd: directory,
    timestamp: '2026-09-21T00:00:00.000Z',
  }
  await fs.writeFile(
    filePath,
    [header, ...records].map(row => JSON.stringify(row)).join('\n') + suffix,
  )
  return readLastAssistantMessageFromSessionFile('pi', filePath)
}

describe('Pi last assistant message', () => {
  it('reads the assistant response from a native Pi v3 session', async () => {
    await expect(
      readLastAssistantMessageFromSessionFile(
        'pi',
        resolve('tests/fixtures/agent/pi-session-redacted.jsonl'),
      ),
    ).resolves.toBe('<redacted>')
  })

  it('joins only text blocks without inserting separators or copying thinking and tool data', async () => {
    await expect(
      readSession([
        message('reply', null, [
          { type: 'thinking', thinking: 'private reasoning' },
          { type: 'text', text: '  Hello ' },
          { type: 'toolCall', name: 'read', arguments: {} },
          { type: 'text', text: 'world!\r\nNext line.  ' },
        ]),
      ]),
    ).resolves.toBe('Hello world!\nNext line.')
  })

  it('follows the saved leaf ancestry instead of copying from an abandoned branch', async () => {
    await expect(
      readSession([
        reply('shared', null, 'Shared answer'),
        reply('branch-a', 'shared', 'Selected answer'),
        reply('branch-b', 'shared', 'Abandoned answer'),
        { type: 'custom', id: 'leaf', parentId: 'branch-a', customType: 'selected-branch' },
      ]),
    ).resolves.toBe('Selected answer')
  })

  it('returns no message when the saved branch contains no assistant response', async () => {
    await expect(
      readSession([
        reply('abandoned', null, 'Unrelated answer'),
        {
          type: 'message',
          id: 'user',
          parentId: null,
          message: { role: 'user', content: 'Hello' },
        },
      ]),
    ).resolves.toBeNull()
  })

  it('does not fall back to an older answer when the latest assistant has no text', async () => {
    await expect(
      readSession([
        reply('older', null, 'Previous answer'),
        message('latest', 'older', [{ type: 'toolCall', name: 'read', arguments: {} }], 'toolUse'),
        {
          type: 'message',
          id: 'result',
          parentId: 'latest',
          message: { role: 'toolResult', content: [{ type: 'text', text: 'Tool result' }] },
        },
      ]),
    ).resolves.toBeNull()
  })

  it('skips an empty aborted assistant message like Pi native copy', async () => {
    await expect(
      readSession([
        reply('older', null, 'Completed answer'),
        message('aborted', 'older', [], 'aborted'),
      ]),
    ).resolves.toBe('Completed answer')
  })

  it.each([null, undefined])('skips an aborted message with nullish content %s', async content => {
    await expect(
      readSession([
        reply('older', null, 'Completed answer'),
        {
          type: 'message',
          id: 'aborted',
          parentId: 'older',
          message: { role: 'assistant', content, stopReason: 'aborted' },
        },
      ]),
    ).resolves.toBe('Completed answer')
  })

  it('ignores an incomplete trailing append and reads a complete reply without a final newline', async () => {
    await expect(readSession([reply('reply', null, 'Complete answer')])).resolves.toBe(
      'Complete answer',
    )
    await expect(
      readSession([reply('reply', null, 'Complete answer')], '\n{"type":"message"'),
    ).resolves.toBe('Complete answer')
  })

  it('terminates safely on a malformed ancestry cycle', async () => {
    await expect(
      readSession([
        { type: 'custom', id: 'first', parentId: 'second' },
        { type: 'custom', id: 'second', parentId: 'first' },
      ]),
    ).resolves.toBeNull()
  })

  it.each([
    ['user', null],
    ['old', 'Previous answer'],
    ['missing', null],
  ])('respects the compaction retained boundary %s', async (firstKeptEntryId, expected) => {
    await expect(
      readSession([
        reply('old', null, 'Previous answer'),
        {
          type: 'message',
          id: 'user',
          parentId: 'old',
          message: { role: 'user', content: 'Next' },
        },
        {
          type: 'compaction',
          id: 'compact',
          parentId: 'user',
          firstKeptEntryId,
          summary: 'Summary is not an answer',
        },
      ]),
    ).resolves.toBe(expected)
  })

  it('copies a new answer after compaction and ignores an abandoned compaction', async () => {
    await expect(
      readSession([
        reply('old', null, 'Previous answer'),
        { type: 'compaction', id: 'compact', parentId: 'old', firstKeptEntryId: 'missing' },
        reply('latest', 'compact', 'New answer'),
        { type: 'compaction', id: 'abandoned', parentId: 'latest', firstKeptEntryId: 'missing' },
        { type: 'custom', id: 'leaf', parentId: 'latest' },
      ]),
    ).resolves.toBe('New answer')
  })

  it('follows branch summary parentId and transparent future entries, never fromId', async () => {
    await expect(
      readSession([
        reply('selected', null, 'Selected answer'),
        reply('abandoned', 'selected', 'Abandoned answer'),
        {
          type: 'branch_summary',
          id: 'summary',
          parentId: 'selected',
          fromId: 'abandoned',
          summary: 'Not assistant text',
        },
        { type: 'future_entry_type', id: 'leaf', parentId: 'summary' },
      ]),
    ).resolves.toBe('Selected answer')
  })

  it.each([1, 2, 4])('does not interpret unsupported session version %s', async version => {
    await expect(
      readSession([reply('reply', null, 'Unsupported answer')], '', version),
    ).resolves.toBeNull()
  })
})
