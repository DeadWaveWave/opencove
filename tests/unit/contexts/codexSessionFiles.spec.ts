import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listCodexSessionFiles } from '../../../src/contexts/agent/infrastructure/cli/CodexSessionFiles'
import { resolveCodexInvocationArguments } from '../../../src/contexts/agent/infrastructure/cli/CodexInvocationArguments'

describe('Codex file identity inputs', () => {
  it('finds and verifies an exact old resume file without relying on recent dates or mtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-codex-resume-'))
    const directory = join(root, 'sessions', '2024', '01', '02')
    try {
      await mkdir(directory, { recursive: true })
      const timestamp = '2024-01-02T12:00:00.000Z'
      const filePath = join(directory, 'rollout-exact-id.jsonl')
      const meta = {
        type: 'session_meta',
        timestamp,
        payload: { id: 'exact-id', cwd: 'C:/old-workspace', timestamp },
      }
      await writeFile(filePath, JSON.stringify(meta) + '\n')
      expect(
        await listCodexSessionFiles({
          cwd: process.cwd(),
          startedAtMs: Date.now(),
          codexHomeDirectories: [root],
          sessionId: 'exact-id',
        }),
      ).toMatchObject([{ sessionId: 'exact-id', filePath }])
      await writeFile(
        filePath,
        JSON.stringify({ ...meta, payload: { ...meta.payload, id: 'different-id' } }) + '\n',
      )
      expect(
        await listCodexSessionFiles({
          cwd: process.cwd(),
          startedAtMs: Date.now(),
          codexHomeDirectories: [root],
          sessionId: 'exact-id',
        }),
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves explicit resume after access flags and honors the actual CLI working directory', () => {
    expect(
      resolveCodexInvocationArguments(
        [
          '--sandbox',
          'workspace-write',
          '--ask-for-approval',
          'on-request',
          '--cd=child',
          'resume',
          'exact-id',
        ],
        process.cwd(),
      ),
    ).toEqual({
      cwd: join(process.cwd(), 'child'),
      resumeSessionId: 'exact-id',
      discoverNewSession: false,
    })
  })

  it.each([
    ['resume'],
    ['resume', '--last'],
    ['--remote', 'ws://localhost:8000'],
    ['exec', 'task'],
    ['--unknown', 'resume'],
  ])(
    'does not guess a new session for unsupported or interactive identity selection: %j',
    (...args) => {
      expect(resolveCodexInvocationArguments(args, process.cwd())).toMatchObject({
        resumeSessionId: null,
        discoverNewSession: false,
      })
    },
  )
})
