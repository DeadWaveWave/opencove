import { resolve } from 'node:path'
import type {
  AgentSessionDiscovery,
  AgentSessionDiscoveryHandle,
  DiscoveredAgentSession,
} from '../../application/ports/AgentSessionDiscovery'
import type { TerminalAgentHookContext } from '../../../../shared/runtime/agentHook/agentHookChannel'
import { listCodexSessionFiles } from './CodexSessionFiles'

interface DiscoveryRecord {
  cwd: string
  startedAtMs: number
  expectedSessionId: string | null
  codexHomeDirectories?: readonly string[]
  sessionId: string | null
  terminalActivity: TerminalAgentHookContext | null
  ambiguous: boolean
  disposed: boolean
  result: DiscoveredAgentSession | null
  pending: Promise<DiscoveredAgentSession | null> | null
  timer: ReturnType<typeof setTimeout> | null
  attempts: number
}

/** One runtime owns launch claims; filesystem observations never select a different invocation. */
export class CodexSessionFileDiscovery implements AgentSessionDiscovery {
  private readonly records = new Set<DiscoveryRecord>()
  private readonly sessions = new Map<string, DiscoveryRecord>()

  constructor(
    private readonly options: {
      readFiles?: typeof listCodexSessionFiles
      now?: () => number
    } = {},
  ) {}

  reserve(input: {
    cwd: string
    resumeSessionId?: string | null
    environment?: Readonly<NodeJS.ProcessEnv>
    discoverNewSession?: boolean
  }): {
    start: (sessionId: string, activity?: TerminalAgentHookContext) => void
    dispose: () => Promise<void>
  } {
    const cwd = resolve(input.cwd)
    const codexHome = input.environment?.CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim()
    const record: DiscoveryRecord = {
      cwd: process.platform === 'win32' ? cwd.toLowerCase() : cwd,
      startedAtMs: (this.options.now ?? Date.now)(),
      expectedSessionId: input.resumeSessionId ?? null,
      ...(codexHome ? { codexHomeDirectories: [codexHome] } : {}),
      sessionId: null,
      terminalActivity: null,
      ambiguous: input.discoverNewSession === false && !input.resumeSessionId,
      disposed: false,
      result: null,
      pending: null,
      timer: null,
      attempts: 0,
    }
    // Overlapping unbound launches have no reliable ordering in rollout timestamps.
    // Keep ambiguity sticky even if one exits first; late files must not transfer ownership.
    for (const other of this.records) {
      if (
        this.isCurrent(other) &&
        other.cwd === record.cwd &&
        !other.result &&
        !other.expectedSessionId &&
        !record.expectedSessionId
      ) {
        other.ambiguous = true
        record.ambiguous = true
      }
    }
    this.records.add(record)
    return {
      start: (sessionId, activity) => {
        if (record.disposed || record.sessionId) {
          return
        }
        record.sessionId = sessionId
        record.terminalActivity = activity ?? null
        this.sessions.set(sessionId, record)
        // Terminal identity must persist even while no renderer is attached. Ordinary
        // Agent state watchers use the same captured resolver without a second scan.
        if (activity) {
          this.schedule(record)
        }
      },
      dispose: async () => {
        record.disposed = true
        if (record.timer) {
          clearTimeout(record.timer)
        }
        this.records.delete(record)
        if (record.sessionId && this.sessions.get(record.sessionId) === record) {
          this.sessions.delete(record.sessionId)
        }
      },
    }
  }

  capture(sessionId: string): AgentSessionDiscoveryHandle | null {
    const record = this.sessions.get(sessionId)
    return record
      ? {
          resolve: () => this.resolveRecord(record),
          isCurrent: () => this.isCurrent(record),
        }
      : null
  }

  private isCurrent(record: DiscoveryRecord): boolean {
    return (
      !record.disposed &&
      (!record.terminalActivity || record.terminalActivity.isCurrent()) &&
      (!record.sessionId || this.sessions.get(record.sessionId) === record)
    )
  }

  private schedule(record: DiscoveryRecord): void {
    if ((this.options.now ?? Date.now)() - record.startedAtMs > 30 * 60_000) {
      return
    }
    record.timer = setTimeout(
      () => {
        record.timer = null
        void this.resolveRecord(record).then(result => {
          if (!result && this.isCurrent(record) && !record.ambiguous) {
            this.schedule(record)
          }
        })
      },
      Math.min(500 * 2 ** record.attempts++, 10_000),
    )
    record.timer.unref?.()
  }

  private async resolveRecord(record: DiscoveryRecord): Promise<DiscoveredAgentSession | null> {
    if (!this.isCurrent(record) || record.ambiguous) {
      return null
    }
    if (record.result) {
      return record.result
    }
    if (record.pending) {
      return await record.pending
    }
    const pending = this.discover(record).catch(() => null)
    record.pending = pending
    try {
      return await pending
    } finally {
      if (record.pending === pending) {
        record.pending = null
      }
    }
  }

  private async discover(record: DiscoveryRecord): Promise<DiscoveredAgentSession | null> {
    const files = await (this.options.readFiles ?? listCodexSessionFiles)({
      cwd: record.cwd,
      startedAtMs: record.startedAtMs,
      codexHomeDirectories: record.codexHomeDirectories,
      sessionId: record.expectedSessionId,
    })
    if (!this.isCurrent(record) || record.ambiguous) {
      return null
    }
    const candidates = files.filter(file => {
      if (record.expectedSessionId) {
        return file.sessionId === record.expectedSessionId
      }
      // Subagent/exec rollouts share the parent's cwd but are not this interactive CLI.
      if (file.source !== undefined && file.source !== 'cli') {
        return false
      }
      // Old session_meta can be replayed with a new record timestamp during resume.
      const createdAt = file.payloadTimestampMs ?? file.recordTimestampMs
      if (createdAt === null || createdAt < record.startedAtMs) {
        return false
      }
      return ![...this.records].some(
        other =>
          other !== record &&
          (other.result?.resumeSessionId === file.sessionId ||
            other.expectedSessionId === file.sessionId),
      )
    })
    const ids = new Set(candidates.map(file => file.sessionId))
    if (ids.size !== 1) {
      return null
    }
    const file = candidates[0]
    if (
      record.terminalActivity &&
      !record.terminalActivity.observe?.({
        identityAuthority: 'session_file',
        resumeSessionId: file.sessionId,
      })
    ) {
      return null
    }
    record.result = { resumeSessionId: file.sessionId, filePath: file.filePath }
    return record.result
  }
}
