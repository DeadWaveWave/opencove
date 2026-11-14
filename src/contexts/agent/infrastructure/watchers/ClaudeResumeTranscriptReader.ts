import { ClaudeTranscriptReadBudget, awaitTranscriptIO } from './ClaudeTranscriptReadBudget'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
  claudeTranscriptAccess,
  claudeTranscriptRoots,
  type ClaudeTranscriptRoots,
} from './ClaudeTranscriptAccess'
import type {
  ClaudeQualificationIdentity,
  ClaudeResumeProof,
} from '../../application/managedClaudeLaunch/qualification'

const MAX_SCAN = 8 * 1024 * 1024,
  MAX_TOTAL = 32 * 1024 * 1024,
  MAX_RECORD = 1024 * 1024
/** Exact authenticated file only. Never scans a suffix or returns transcript content. */
export class ClaudeResumeTranscriptReader {
  private readonly roots: ClaudeTranscriptRoots
  constructor(
    configDirectories: readonly string[],
    private readonly bounds = { deadlineMs: 2000, retryMs: 250 },
  ) {
    this.roots = claudeTranscriptRoots(configDirectories)
  }
  async confirmCompletedTurn(
    input: ClaudeQualificationIdentity & { transcriptPath: string; deadlineAt?: number },
    signal: AbortSignal,
  ): Promise<ClaudeResumeProof | null> {
    const deadline = Math.min(
      input.deadlineAt ?? Infinity,
      performance.now() + this.bounds.deadlineMs,
    )
    const budget = new ClaudeTranscriptReadBudget(deadline, signal)
    try {
      const proof = await budget.wait(() => this.scan(input, budget, deadline))
      return budget.active ? proof : null
    } catch {
      return null
    } finally {
      budget.dispose()
    }
  }
  private async scan(
    input: ClaudeQualificationIdentity & { transcriptPath: string },
    budget: ClaudeTranscriptReadBudget,
    deadline: number,
  ): Promise<ClaudeResumeProof | null> {
    const signal = budget.signal
    const access = claudeTranscriptAccess(input.transcriptPath, input.resumeSessionId, this.roots)
    let total = 0
    while (!signal.aborted && performance.now() < deadline && total < MAX_TOTAL) {
      try {
        const handle = await budget.wait(
          () => access.open(signal),
          lateHandle => {
            void lateHandle.close().catch(() => {})
          },
        )
        try {
          const before = await budget.wait(() => handle.stat())
          if (before.size > MAX_SCAN || total + before.size > MAX_TOTAL) {
            return null
          }
          const chunks: Buffer[] = []
          let position = 0
          while (position < before.size && !signal.aborted && performance.now() < deadline) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, before.size - position))
            const { bytesRead } = await budget.wait(() =>
              handle.read(buffer, 0, buffer.length, position),
            )
            if (!bytesRead) {
              break
            }
            chunks.push(buffer.subarray(0, bytesRead))
            position += bytesRead
            total += bytesRead
          }
          if (signal.aborted || performance.now() >= deadline) {
            return null
          }
          const after = await budget.wait(() => handle.stat())
          const current = await budget.wait(() => access.validate(signal))
          if (
            before.dev !== current.dev ||
            before.ino !== current.ino ||
            before.dev !== after.dev ||
            before.ino !== after.ino
          ) {
            return null
          }
          if (after.size > MAX_SCAN) {
            return null
          }
          // Append, truncation/regrowth and same-size rewrites invalidate this entire scan.
          // Retry the full file, never certify the old prefix as the current conversation.
          const stable =
            position === before.size &&
            before.size === after.size &&
            before.mtimeMs === after.mtimeMs &&
            before.ctimeMs === after.ctimeMs
          const raw = Buffer.concat(chunks)
          // A partial tail never becomes a valid prefix proof, even following an end_turn.
          if (stable && raw.length && raw.at(-1) === 10 && completed(raw, input)) {
            return {
              ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
              occurrenceId: input.occurrenceId,
              ordinal: input.ordinal,
              resumeSessionId: input.resumeSessionId,
              promptId: input.promptId,
              evidenceId: randomUUID(),
            }
          }
        } finally {
          await awaitTranscriptIO(handle.close(), signal)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'UNSAFE_TRANSCRIPT') {
          return null
        }
      }
      if (signal.aborted || performance.now() >= deadline) {
        break
      }
      try {
        await delay(
          Math.min(this.bounds.retryMs, Math.max(0, deadline - performance.now())),
          undefined,
          { signal },
        )
      } catch {
        return null
      }
    }
    return null
  }
}

function completed(raw: Buffer, input: ClaudeQualificationIdentity): boolean {
  const parents = new Map<string, { parent?: string; promptId?: string }>()
  const users = new Set<string>()
  let proof = false
  for (const line of raw.toString('utf8').split('\n')) {
    if (!line) {
      continue
    }
    if (Buffer.byteLength(line) > MAX_RECORD) {
      return false
    }
    let record
    try {
      record = JSON.parse(line)
    } catch {
      return false
    }
    if (!record || typeof record !== 'object') {
      return false
    }
    if (record.isSidechain === true) {
      continue
    }
    if (typeof record.sessionId === 'string' && record.sessionId !== input.resumeSessionId) {
      return false
    }
    // Claude links attachments and system records into the conversation chain between a
    // prompt and its reply, so every chained record must be indexed, not only messages.
    const uuid = typeof record.uuid === 'string' ? record.uuid : undefined
    const parent = typeof record.parentUuid === 'string' ? record.parentUuid : undefined
    if (uuid) {
      if (parents.has(uuid)) {
        return false
      }
      parents.set(uuid, {
        parent,
        promptId: typeof record.promptId === 'string' ? record.promptId : undefined,
      })
    }
    if (record.type !== 'user' && record.type !== 'assistant') {
      continue
    }
    if (record.sessionId !== input.resumeSessionId) {
      return false
    }
    if (record.type === 'user' && record.promptId === input.promptId && uuid) {
      users.add(uuid)
    }
    if (record.type !== 'assistant' || record.message?.stop_reason !== 'end_turn') {
      continue
    }
    if (typeof record.promptId === 'string' && record.promptId !== input.promptId) {
      continue
    }
    let ancestor = parent
    const visited = new Set<string>()
    while (ancestor && !visited.has(ancestor)) {
      const node = parents.get(ancestor)
      if (!node || (node.promptId !== undefined && node.promptId !== input.promptId)) {
        break
      }
      if (users.has(ancestor)) {
        proof = true
        break
      }
      visited.add(ancestor)
      ancestor = node.parent
    }
  }
  return proof
}
