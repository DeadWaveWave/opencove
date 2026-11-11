// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as transcriptAccess from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
import { ClaudeResumeTranscriptReader } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeResumeTranscriptReader'

// Every case starts with the real 2.1.321 clear-successor shape, including attachments/system.
const real = readFileSync(
  join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
  'utf8',
)
let root: string, path: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-reader-correlation-'))
  await mkdir(join(root, 'projects', 'workspace'), { recursive: true })
  path = join(root, 'projects', 'workspace', 'B.jsonl')
  await writeFile(path, real)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const identity = { occurrenceId: 'occ', ordinal: 1, resumeSessionId: 'B', promptId: 'p' }
const read = () =>
  new ClaudeResumeTranscriptReader([root], { deadlineMs: 100, retryMs: 1 }).confirmCompletedTurn(
    { ...identity, transcriptPath: path },
    new AbortController().signal,
  )
function insertBeforeReply(record: object) {
  return real
    .replace(
      '"parentUuid":"r14","isSidechain":false,"message"',
      '"parentUuid":"intermediate","isSidechain":false,"message"',
    )
    .replace('{"type":"assistant"', JSON.stringify(record) + '\n{"type":"assistant"')
}
it.each(['different user prompt', 'conflicting assistant prompt', 'conflicting attachment prompt'])(
  'refuses %s across the real attachment chain',
  async kind => {
    const changed =
      kind === 'different user prompt'
        ? insertBeforeReply({
            type: 'user',
            sessionId: 'B',
            uuid: 'intermediate',
            parentUuid: 'r14',
            promptId: 'q',
          })
        : kind === 'conflicting attachment prompt'
          ? insertBeforeReply({
              type: 'attachment',
              sessionId: 'B',
              uuid: 'intermediate',
              parentUuid: 'r14',
              promptId: 'q',
            })
          : real.replace('"uuid":"r15"', '"uuid":"r15","promptId":"q"')
    await writeFile(path, changed)
    expect(await read()).toBeNull()
  },
)
it('permits real attachments and tool-use / promptless tool-result intermediates', async () => {
  expect(await read()).toMatchObject(identity)
  const toolLoop = [
    {
      type: 'assistant',
      sessionId: 'B',
      uuid: 'tool',
      parentUuid: 'r14',
      message: { role: 'assistant', stop_reason: 'tool_use' },
    },
    {
      type: 'user',
      sessionId: 'B',
      uuid: 'intermediate',
      parentUuid: 'tool',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool' }] },
    },
  ]
    .map(record => JSON.stringify(record))
    .join('\n')
  await writeFile(
    path,
    real
      .replace(
        '"parentUuid":"r14","isSidechain":false,"message"',
        '"parentUuid":"intermediate","isSidechain":false,"message"',
      )
      .replace('{"type":"assistant"', toolLoop + '\n{"type":"assistant"'),
  )
  expect(await read()).toMatchObject(identity)
})

it.each(['partial append', 'larger rewrite', 'oversized append', 'stable retry'])(
  'revalidates %s instead of certifying the original prefix',
  async kind => {
    const original = transcriptAccess.claudeTranscriptAccess
    let changed = false,
      scans = 0
    vi.spyOn(transcriptAccess, 'claudeTranscriptAccess').mockImplementation((...args) => {
      const capability = original(...args)
      return {
        ...capability,
        open: async () => {
          scans++
          const handle = await capability.open(),
            stat = handle.stat.bind(handle)
          let calls = 0
          vi.spyOn(handle, 'stat').mockImplementation(async () => {
            if (++calls === 2 && !changed) {
              changed = true
              if (kind === 'partial append') {
                await writeFile(path, real + '{')
              }
              if (kind === 'larger rewrite') {
                await writeFile(
                  path,
                  real.replace('"stop_reason":"end_turn"', '"stop_reason":"error"') +
                    JSON.stringify({ type: 'cost-state', padding: 'longer-rewritten-file' }) +
                    '\n',
                )
              }
              if (kind === 'oversized append') {
                await writeFile(path, real + ' '.repeat(8 * 1024 * 1024))
              }
              if (kind === 'stable retry') {
                return { ...(await stat()), size: Buffer.byteLength(real) + 1 }
              }
            }
            return stat()
          })
          return handle
        },
      }
    })
    const proof = await read()
    if (kind === 'stable retry') {
      expect(proof).toMatchObject(identity)
      expect(scans).toBeGreaterThan(1)
    } else {
      expect(proof).toBeNull()
    }
  },
)
