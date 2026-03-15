import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import type { ResolveAgentResumeSessionResult } from '../../../src/shared/contracts/dto'
import type { PtyRuntime } from '../../../src/contexts/terminal/presentation/main-ipc/runtime'
import { invokeHandledIpc } from '../../contract/ipc/ipcTestUtils'

function createIpcHarness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }

  return { handlers, ipcMain }
}

function toDateParts(timestampMs: number): { year: string; month: string; day: string } {
  const date = new Date(timestampMs)
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  }
}

function createRolloutFirstLine({
  sessionId,
  cwd,
  timestamp,
}: {
  sessionId: string
  cwd: string
  timestamp: string
}): string {
  return JSON.stringify({
    timestamp,
    type: 'session_meta',
    payload: {
      id: sessionId,
      cwd,
      timestamp,
    },
  })
}

describe('agent:resolve-resume-session IPC', () => {
  it('waits for late codex session meta and returns the resolved resumeSessionId', async () => {
    vi.resetModules()

    const tempHome = await fs.mkdtemp(join(tmpdir(), 'cove-agent-resolve-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = tempHome

    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    const { year, month, day } = toDateParts(startedAtMs)
    const cwd = join(tempHome, 'workspace')
    const sessionsDir = join(tempHome, '.codex', 'sessions', year, month, day)
    const rolloutPath = join(sessionsDir, 'rollout-late.jsonl')

    let timer: ReturnType<typeof setTimeout> | null = null

    try {
      await fs.mkdir(cwd, { recursive: true })

      const { handlers, ipcMain } = createIpcHarness()
      vi.doMock('electron', () => ({ ipcMain }))

      const runtime = {} as unknown as PtyRuntime
      const approvedWorkspaces = {
        registerRoot: vi.fn(async () => undefined),
        isPathApproved: vi.fn(async () => true),
      }

      const { registerAgentIpcHandlers } =
        await import('../../../src/contexts/agent/presentation/main-ipc/register')

      registerAgentIpcHandlers(runtime, approvedWorkspaces)

      const handler = handlers.get(IPC_CHANNELS.agentResolveResumeSession)
      expect(handler).toBeTypeOf('function')

      const resolvePromise = invokeHandledIpc<ResolveAgentResumeSessionResult>(handler, null, {
        provider: 'codex',
        cwd,
        startedAt,
      })

      timer = setTimeout(() => {
        void (async () => {
          await fs.mkdir(sessionsDir, { recursive: true })
          await fs.writeFile(
            rolloutPath,
            `${createRolloutFirstLine({
              sessionId: 'session-ipc-late',
              cwd,
              timestamp: new Date(startedAtMs + 150).toISOString(),
            })}
`,
            'utf8',
          )
        })()
      }, 350)

      await expect(resolvePromise).resolves.toEqual({ resumeSessionId: 'session-ipc-late' })
      expect(approvedWorkspaces.isPathApproved).toHaveBeenCalledWith(cwd)
    } finally {
      if (timer) {
        clearTimeout(timer)
      }

      process.env.HOME = previousHome
      await fs.rm(tempHome, { recursive: true, force: true })
    }
  })
})
