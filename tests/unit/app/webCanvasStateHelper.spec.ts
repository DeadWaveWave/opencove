// @vitest-environment node
import type { APIRequestContext } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let helpers: typeof import('../../e2e-web-canvas/helpers')
beforeAll(async () => {
  vi.stubEnv('OPENCOVE_WEB_CANVAS_BASE_URL', 'http://localhost')
  vi.stubEnv('OPENCOVE_WEB_CANVAS_TOKEN', 'test-token')
  vi.stubEnv('OPENCOVE_WEB_CANVAS_WORKSPACE_ROOT', '/workspace')
  helpers = await import('../../e2e-web-canvas/helpers')
})
afterAll(() => vi.unstubAllEnvs())

function fixture(conflicts = 0, failure?: Record<string, unknown>) {
  let revision = 1
  let state = {
    activeWorkspaceId: 'workspace',
    workspaces: [
      {
        id: 'workspace',
        nodes: [{ id: 'terminal', kind: 'terminal', title: 'terminal-1', width: 600 }],
        spaces: [],
      },
    ],
    settings: { external: 'initial' },
  }
  const post = vi.fn(async (_url: string, options: { data: { id: string; payload: unknown } }) => {
    let envelope: unknown
    if (options.data.id === 'sync.state') {
      envelope = { ok: true, value: { revision, state: structuredClone(state) } }
    } else {
      const payload = options.data.payload as { state: typeof state; baseRevision: number }
      // A renderer publication commits after the helper's read, before its CAS write.
      if (conflicts-- > 0) {
        revision += 1
        state.settings.external = `renderer-${revision}`
        state.workspaces[0].nodes[0].title = 'printf history'
        state.workspaces[0].nodes.push({
          id: `concurrent-${revision}`,
          kind: 'note',
          title: 'concurrent',
          width: 240,
        })
      }
      if (failure || payload.baseRevision !== revision) {
        envelope = {
          ok: false,
          error: failure ?? {
            code: 'persistence.invalid_state',
            debugMessage: `sync.writeState revision conflict (base=${payload.baseRevision}, current=${revision})`,
          },
        }
      } else {
        state = structuredClone(payload.state)
        envelope = { ok: true, value: { revision: ++revision } }
      }
    }
    return { ok: () => true, status: () => 200, json: async () => envelope }
  })
  return {
    request: { post } as unknown as APIRequestContext,
    writes: () => post.mock.calls.filter(([, options]) => options.data.id === 'sync.writeState'),
    state: () => state,
  }
}

describe('web canvas state helper', () => {
  it('rebases the intended resize after a racing renderer write without dropping its state', async () => {
    const f = fixture(1)
    await helpers.writeAppState(f.request, current => {
      if (!current) {
        throw new Error('Missing state')
      }
      const terminal = current.workspaces[0].nodes.find(node => node.id === 'terminal')!
      terminal.width = Number(terminal.width) + 340
      return current
    })
    expect(f.writes()).toHaveLength(2)
    expect(f.state().settings.external).toBe('renderer-2')
    expect(f.state().workspaces[0].nodes).toEqual([
      { id: 'terminal', kind: 'terminal', title: 'printf history', width: 940 },
      { id: 'concurrent-2', kind: 'note', title: 'concurrent', width: 240 },
    ])
  })

  it('applies an explicit seed replacement without a conflict', async () => {
    const f = fixture()
    const seed = { activeWorkspaceId: 'new', workspaces: [], settings: {} }
    await helpers.writeAppState(f.request, () => seed)
    expect(f.state()).toEqual(seed)
    expect(f.writes()).toHaveLength(1)
  })

  it('bounds conflict retries and reports the final base and current revisions', async () => {
    const f = fixture(3)
    await expect(helpers.writeAppState(f.request, current => current)).rejects.toThrow(
      'sync.writeState revision conflict (base=3, current=4)',
    )
    expect(f.writes()).toHaveLength(3)
    expect(f.state().settings.external).toBe('renderer-4')
  })

  it.each([
    { code: 'persistence.invalid_state', debugMessage: 'Refusing an empty workspace overwrite.' },
    {
      code: 'persistence.invalid_state',
      debugMessage: 'sync.writeState requires baseRevision (current=1)',
    },
    { code: 'persistence.io_failed', message: 'Disk unavailable' },
  ])(
    'does not retry other failures and preserves diagnostics: $code / $debugMessage / $message',
    async error => {
      const f = fixture(0, error)
      await expect(helpers.writeAppState(f.request, current => current)).rejects.toThrow(
        `200 ${error.code}: ${error.debugMessage ?? error.message}`,
      )
      expect(f.writes()).toHaveLength(1)
    },
  )
})
