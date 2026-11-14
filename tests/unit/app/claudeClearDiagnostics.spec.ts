// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachClearReadinessFailure,
  sanitizeClearDiagnostic,
} from '../../e2e/claude-clear-diagnostics.helpers'

it('attaches the snapshot, hook timeline and only the sanitized successor file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-clear-diagnostic-')),
    config = join(root, 'config')
  try {
    await mkdir(config)
    const transcript = join(config, 'B.jsonl'),
      hookLog = join(root, 'hooks.jsonl')
    await writeFile(
      transcript,
      JSON.stringify({
        type: 'user',
        cwd: root,
        message: { content: '<command-name>/clear</command-name>' },
      }) + '\n',
    )
    await writeFile(
      hookLog,
      JSON.stringify({
        at: '2026-11-13T21:36:40.815Z',
        input: { session_id: 'B', transcript_path: transcript, cwd: root },
      }) + '\n',
    )
    const attach = vi.fn()
    await attachClearReadinessFailure(
      { attach },
      {
        root,
        config,
        hookLog,
        successor: 'B',
        snapshot: async () => ({ state: 'unknown', cwd: root }),
      },
    )
    expect(attach).toHaveBeenCalledOnce()
    const { body, contentType } = attach.mock.calls[0][1]
    expect(contentType).toBe('application/json')
    expect(body).not.toContain(root)
    expect(JSON.parse(body)).toMatchObject({
      snapshot: { state: 'unknown', cwd: '<test-root>' },
      hooks: [{ at: '2026-11-13T21:36:40.815Z' }],
      transcript: expect.stringContaining('/clear'),
    })
    expect(
      sanitizeClearDiagnostic(
        { path: 'C:\\Users\\Casey\\isolated\\B.jsonl' },
        'C:\\Users\\Casey\\isolated',
      ),
    ).not.toContain('Casey')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('does not read a transcript path outside the isolated config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-clear-diagnostic-'))
  try {
    const hookLog = join(root, 'hooks.jsonl'),
      outside = join(root, 'private.jsonl')
    await writeFile(outside, 'PRIVATE_MUST_NOT_ATTACH')
    await writeFile(
      hookLog,
      JSON.stringify({ at: 'now', input: { session_id: 'B', transcript_path: outside } }) + '\n',
    )
    const attach = vi.fn()
    await attachClearReadinessFailure(
      { attach },
      {
        root,
        config: join(root, 'config'),
        hookLog,
        successor: 'B',
        snapshot: async () => ({ state: 'unknown' }),
      },
    )
    expect(attach.mock.calls[0][1].body).not.toContain('PRIVATE_MUST_NOT_ATTACH')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
