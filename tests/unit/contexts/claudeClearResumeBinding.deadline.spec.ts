// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeClearResumeBinding } from '../../../src/contexts/agent/application/ClaudeClearResumeBinding'
import { ClaudeConversationLifecycle } from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'
import { ClaudeResumeTranscriptReader } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeResumeTranscriptReader'
import * as transcriptAccess from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'
const real = readFileSync(
  join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
  'utf8',
)
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it.each(['stalled open', 'late publication'] as const)(
  '%s preserves the deadline and allows the later C commit',
  async kind => {
    const root = await mkdtemp(join(tmpdir(), 'claude-producer-deadline-')),
      directory = join(root, 'projects', 'workspace')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'B.jsonl'), real)
    await writeFile(
      join(directory, 'C.jsonl'),
      real
        .replaceAll('"sessionId":"B"', '"sessionId":"C"')
        .replaceAll('"promptId":"p"', '"promptId":"p-C"'),
    )
    let sequence = 0,
      binding = {
        nodeId: 'n',
        runtimeSessionId: 'r',
        activationId: 'launch',
        tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
        nodeSeen: true,
        bindingRevision: 1,
        observedRevision: 1,
      }
    const commit = vi.fn(async input => {
      binding = { ...binding, activationId: input.activationId, tuple: input.next }
      return { status: 'committed' as const }
    })
    const owner = new ManagedClaudeRebindState(
      {
        observeNode: () => ({ nodeId: 'n', binding, retired: false, context: null }),
        createId: () => `id-${++sequence}`,
        commitManagedClaudeRebind: commit,
      },
      () => 'n',
      () => true,
    )
    const original = transcriptAccess.claudeTranscriptAccess,
      opened = vi.fn()
    vi.spyOn(transcriptAccess, 'claudeTranscriptAccess').mockImplementation((...args) => {
      const capability = original(...args)
      if (args[1] !== 'B' || kind !== 'stalled open') {
        return capability
      }
      return {
        ...capability,
        open: () => {
          opened()
          return new Promise(() => {})
        },
      }
    })
    let release!: () => void, entered!: () => void
    const published = new Promise<void>(resolve => {
        release = resolve
      }),
      checkpoint = new Promise<void>(resolve => {
        entered = resolve
      })
    const reader = new ClaudeResumeTranscriptReader([root]),
      read = vi.fn(async (input, signal) => {
        const proof = await reader.confirmCompletedTurn(input, signal)
        if (kind === 'late publication' && input.resumeSessionId === 'B') {
          entered()
          await published
        }
        return proof
      })
    const producer = new ClaudeClearResumeBinding({
      owner,
      runtimeSessionId: 'r',
      credential: {},
      isCurrent: () => true,
      enabled: () => true,
      createId: () => `occ-${++sequence}`,
      now: () => performance.now(),
      read,
      onDegraded: vi.fn(),
    })
    const lifecycle = new ClaudeConversationLifecycle()
    const send = (hookEventName: string, id: string, at: number, source?: string) => {
      const event = {
        hookEventName,
        claudeSessionId: id,
        emittedAtMs: at,
        sessionStartSource: source,
        promptId: id === 'B' ? 'p' : 'p-C',
        transcriptPath: join(directory, `${id}.jsonl`),
      }
      producer.observe({ event, action: lifecycle.accept(event) })
    }
    vi.useFakeTimers()
    try {
      send('SessionStart', 'A', 1, 'startup')
      send('SessionStart', 'B', 2, 'clear')
      send('UserPromptSubmit', 'B', 3)
      send('Stop', 'B', 4)
      if (kind === 'stalled open') {
        expect(opened).toHaveBeenCalledOnce()
      } else {
        await checkpoint
      }
      await vi.advanceTimersByTimeAsync(2001)
      release()
      await vi.advanceTimersByTimeAsync(0)
      send('SessionStart', 'C', 5, 'clear')
      send('UserPromptSubmit', 'C', 6)
      send('Stop', 'C', 7)
      await vi.waitFor(() => expect(binding.tuple.resumeSessionId).toBe('C'))
      expect(read).toHaveBeenCalledTimes(2)
      expect(commit).toHaveBeenCalledOnce()
    } finally {
      release()
      producer.close()
      owner.dispose()
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  },
)
