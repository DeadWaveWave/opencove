import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { registerAgentSessionCatalogHandlers } from '../../../src/app/main/controlSurface/handlers/agentSessionCatalogHandlers'

const listAgentSessionsMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog', () => ({
  listAgentSessions: listAgentSessionsMock,
}))

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-04-30T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: {
      state: true,
      events: true,
    },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: {
        viewer: true,
        controller: true,
      },
      webAuth: {
        ticketToCookie: true,
        cookieSession: true,
      },
    },
  },
}

describe('control surface agent session catalog handlers', () => {
  beforeEach(() => {
    listAgentSessionsMock.mockReset()
  })

  it('returns normalized provider catalog sessions for approved workspaces', async () => {
    listAgentSessionsMock.mockResolvedValue({
      provider: 'codex',
      cwd: '/repo',
      sessions: [
        {
          sessionId: 'resume-current',
          provider: 'codex',
          cwd: '/repo',
          title: null,
          startedAt: '2026-04-29T00:10:00.000Z',
          updatedAt: '2026-04-29T00:10:00.000Z',
          source: 'codex-file',
        },
      ],
    })

    const controlSurface = createControlSurface()
    registerAgentSessionCatalogHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'agent.listSessions',
      payload: { provider: 'codex', cwd: '/repo', limit: 20 },
    })

    expect(listAgentSessionsMock).toHaveBeenCalledWith({
      provider: 'codex',
      cwd: '/repo',
      limit: 20,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        provider: 'codex',
        cwd: '/repo',
        sessions: [
          {
            sessionId: 'resume-current',
            provider: 'codex',
            cwd: '/repo',
            title: null,
            startedAt: '2026-04-29T00:10:00.000Z',
            updatedAt: '2026-04-29T00:10:00.000Z',
            source: 'codex-file',
          },
        ],
      })
    }
  })

  it('rejects unapproved workspace paths before touching the provider catalog', async () => {
    const controlSurface = createControlSurface()
    registerAgentSessionCatalogHandlers(controlSurface, {
      approvedWorkspaces: {
        registerRoot: async () => undefined,
        isPathApproved: async () => false,
      },
    })

    const result = await controlSurface.invoke(ctx, {
      kind: 'query',
      id: 'agent.listSessions',
      payload: { provider: 'codex', cwd: '/repo', limit: 20 },
    })

    expect(listAgentSessionsMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('common.approved_path_required')
    }
  })
})
