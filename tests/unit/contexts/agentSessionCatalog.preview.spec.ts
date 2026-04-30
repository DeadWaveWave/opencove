import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeSessionPreview,
  parseClaudeFirstUserPreview,
  parseCodexFirstUserPreview,
  readFirstMatchingJsonlValue,
} from '../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog.preview'

describe('AgentSessionCatalog preview helpers', () => {
  const tempDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map(async directory => {
        await rm(directory, { recursive: true, force: true })
      }),
    )
  })

  it('normalizes whitespace and truncates long previews', () => {
    expect(normalizeSessionPreview('  Fix\n\nsession   list   readability  ')).toBe(
      'Fix session list readability',
    )

    expect(normalizeSessionPreview('x'.repeat(200))).toBe(`${'x'.repeat(157)}...`)
  })

  it('extracts first user preview from Claude transcript records', () => {
    expect(
      parseClaudeFirstUserPreview({
        type: 'user',
        content: '  Investigate\n session  list  ',
      }),
    ).toBe('Investigate session list')
  })

  it('extracts first user preview from Codex message records', () => {
    expect(
      parseCodexFirstUserPreview({
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Inspect reload flow' },
          { type: 'text', text: 'and summarize gaps' },
        ],
      }),
    ).toBe('Inspect reload flow and summarize gaps')
  })

  it('extracts first user preview from wrapped Codex response items', () => {
    expect(
      parseCodexFirstUserPreview({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Inspect real rollout records' }],
        },
      }),
    ).toBe('Inspect real rollout records')
  })

  it('skips Codex bootstrap prompts and keeps scanning for the first real task prompt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opencove-agent-preview-'))
    tempDirectories.push(directory)

    const filePath = path.join(directory, 'rollout.jsonl')
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '# AGENTS.md instructions for /repo <environment_context>...</environment_context>',
            },
          ],
        },
      })}\n${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Fix the session list preview' }],
        },
      })}\n`,
      'utf8',
    )

    const result = await readFirstMatchingJsonlValue(filePath, parseCodexFirstUserPreview)

    expect(result).toBe('Fix the session list preview')
  })

  it('stops scanning after the bounded header window', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'opencove-agent-preview-'))
    tempDirectories.push(directory)

    const filePath = path.join(directory, 'rollout.jsonl')
    const largePrefix = `${'a'.repeat(1024)}\n`.repeat(70)
    const lateMatch = `${JSON.stringify({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'too late' }],
    })}\n`

    await writeFile(filePath, `${largePrefix}${lateMatch}`, 'utf8')

    const result = await readFirstMatchingJsonlValue(filePath, parseCodexFirstUserPreview)

    expect(result).toBeNull()
  })
})
