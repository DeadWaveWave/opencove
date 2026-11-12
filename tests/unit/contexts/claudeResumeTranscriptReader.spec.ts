import * as transcriptAccess from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  truncate,
  rename,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeResumeTranscriptReader } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeResumeTranscriptReader'
let root: string, path: string
const user = { type: 'user', sessionId: 'B', uuid: 'u', promptId: 'p' }
const assistant = {
  type: 'assistant',
  sessionId: 'B',
  uuid: 'a',
  parentUuid: 'u',
  message: { stop_reason: 'end_turn' },
}
const lines = (...records: unknown[]) =>
  records.map(record => JSON.stringify(record)).join('\n') + '\n'
const identity = { occurrenceId: 'occ', ordinal: 1, resumeSessionId: 'B', promptId: 'p' }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-resume-proof-'))
  await mkdir(join(root, 'projects', 'workspace'), { recursive: true })
  path = join(root, 'projects', 'workspace', 'B.jsonl')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
// Refusals wait out the whole deadline, so they keep it short. A proof returns as soon as one
// scan completes, so it gets a deadline a loaded CI runner cannot miss.
const PROOF_DEADLINE_MS = 5000
const read = (deadlineMs = 20) =>
  new ClaudeResumeTranscriptReader([root], { deadlineMs, retryMs: 1 }).confirmCompletedTurn(
    { ...identity, transcriptPath: path },
    new AbortController().signal,
  )
const confirm = () => read(PROOF_DEADLINE_MS)
describe('bounded Claude resume proof', () => {
  it('confirms a parent chain without returning message content', async () => {
    await writeFile(
      path,
      lines(
        user,
        { ...assistant, uuid: 'tool', message: { stop_reason: 'tool_use' } },
        { ...assistant, parentUuid: 'tool' },
      ),
    )
    expect(await confirm()).toMatchObject({ ...identity, evidenceId: expect.any(String) })
    expect(JSON.stringify(await confirm())).not.toContain('stop_reason')
  })
  it('confirms the Claude 2.1.321 clear successor, whose prompt and reply are linked through attachments', async () => {
    // Redacted from a real Claude 2.1.321 transcript after /clear: ids renamed, content removed.
    const real = await readFile(
      join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
      'utf8',
    )
    await writeFile(path, real)
    expect(await confirm()).toMatchObject({ ...identity, evidenceId: expect.any(String) })
    const withoutPrompt = real
      .split('\n')
      .filter(line => !line.includes('"promptId":"p"'))
      .join('\n')
    await writeFile(path, withoutPrompt)
    expect(await read()).toBeNull()
    const brokenChain = real.replace('"uuid":"r8"', '"uuid":"r8x"')
    await writeFile(path, brokenChain)
    expect(await read()).toBeNull()
  })
  it.each([
    ['partial tail', lines(user, assistant) + '{'],
    [
      'foreign chained record',
      lines(user, { type: 'attachment', sessionId: 'A', uuid: 'x', parentUuid: 'u' }, assistant),
    ],
    ['wrong session', lines(user, { ...assistant, sessionId: 'A' })],
    ['missing user', lines(assistant)],
    ['wrong prompt', lines({ ...user, promptId: 'wrong' }, assistant)],
    ['sidechain', lines({ ...user, isSidechain: true }, assistant)],
    ['broken chain', lines(user, { ...assistant, parentUuid: 'missing' })],
    ['failure only', lines(user, { ...assistant, message: { stop_reason: 'error' } })],
    ['huge first turn', lines({ ...user, content: 'x'.repeat(1024 * 1024) }, assistant)],
    ['oversized file', ' '.repeat(8 * 1024 * 1024 + 1)],
  ])('refuses %s', async (_name, raw) => {
    await writeFile(path, raw)
    expect(await read()).toBeNull()
  })
  it('rejects a symlink leaf', async () => {
    const outside = join(root, 'other')
    await writeFile(outside, lines(user, assistant))
    await symlink(outside, path)
    expect(await read()).toBeNull()
  })
})

it.each(['truncate', 'replace'] as const)(
  'rejects same-read %s before certifying a completed prefix',
  async kind => {
    await writeFile(path, lines(user, assistant))
    const original = transcriptAccess.claudeTranscriptAccess
    vi.spyOn(transcriptAccess, 'claudeTranscriptAccess').mockImplementation((...args) => {
      const capability = original(...args)
      return {
        ...capability,
        open: async () => {
          const handle = await capability.open(),
            stat = handle.stat.bind(handle)
          let calls = 0
          vi.spyOn(handle, 'stat').mockImplementation(async () => {
            if (++calls === 2) {
              if (kind === 'truncate') {
                await truncate(path, 0)
              } else {
                await rename(path, path + '.old')
                await writeFile(path, lines(user, assistant))
              }
            }
            return stat()
          })
          return handle
        },
      }
    })
    expect(await read()).toBeNull()
  },
)
