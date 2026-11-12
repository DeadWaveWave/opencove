// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentPromptHandlers } from '../../../src/app/main/controlSurface/handlers/agentPromptHandlers'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { selectCodexSkills } from '../../fixtures/provider-argv/stringOptions.mjs'
import type { AgentProviderId } from '../../../src/shared/contracts/dto'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const deliveryId = 'a0e2d356-aecf-4784-84ce-9a49c8ed0b78'
const prefixes = {
  'claude-code': ['! printenv X', '/permissions', '  /approvals', '# note', '& task'],
  codex: ['! printenv X', '/permissions', '  /approvals'],
  opencode: ['! printenv X', '/permissions'],
  pi: ['! printenv X', '!! printenv X', '/permissions'],
  kimi: ['/permissions'],
  gemini: ['! printenv X', '/permissions'],
} satisfies Record<AgentProviderId, string[]>
function fixture(provider: AgentProviderId, caller: 'grant' | 'bearer' | 'cookie' = 'grant') {
  const f = promptDeliveryRuntimeFixture(undefined, provider)
  const surface = createControlSurface()
  const service = registerAgentPromptHandlers(
    surface,
    f.hub,
    new AgentProviderRegistry(createBuiltinAgentProviderContributions()),
  )
  const { grant } = new SessionGrantRegistry(() => true).issue({
    sessionId: 'caller-session',
    nodeId: 'n',
    projectId: 'p',
    spaceId: 'space',
  })
  const base = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 64000,
  })
  const ctx = {
    ...base,
    requestAuth:
      caller === 'grant'
        ? { kind: 'session-grant' as const, grant }
        : caller === 'bearer'
          ? { kind: 'bearer' as const }
          : { kind: 'cookie' as const, webSessionGeneration: 0 },
  }
  return {
    ...f,
    send: (text: string, locator: object = { nodeId: 'n' }) =>
      surface.invoke(ctx, {
        kind: 'command',
        id: 'agent.prompt',
        payload: { ...locator, text, deliveryId },
      }),
    lookup: () =>
      surface.invoke(ctx, { kind: 'query', id: 'agent.delivery.get', payload: { deliveryId } }),
    dispose: () => {
      service.dispose()
      f.dispose()
    },
  }
}
async function probe(f: ReturnType<typeof fixture>, text: string, locator?: object) {
  const pending = f.send(text, locator)
  await vi.advanceTimersByTimeAsync(300)
  f.observe('UserPromptSubmit', Date.now())
  return await pending
}
for (const provider of Object.keys(prefixes) as AgentProviderId[]) {
  for (const locator of [{ nodeId: 'n' }, { sessionId: 's' }, { nodeId: '@self' }]) {
    it.each([
      ...prefixes[provider],
      ...['exit', 'quit', ':q', ':q!', ':wq', ':wq!'].map(word => `\u0085${word}\u001c`),
      'Please inspect @file',
      'Explain \\@file',
      'Explain "@file"',
      ...(provider === 'codex'
        ? [
            'Use $explain please',
            'Use "$explain" please',
            'Use \\$explain please',
            'Use [$explain](skill://explain) please',
          ]
        : []),
    ])(
      `${provider}/${JSON.stringify(locator)} refuses command input %j before PTY input or record allocation`,
      async text => {
        const f = fixture(provider)
        try {
          const result = await probe(f, text, locator)
          if (provider === 'codex') {
            expect(selectCodexSkills(f.write.mock.calls.map(call => call[1]).join(''))).toEqual([])
          }
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'common.forbidden',
              details: {
                reason: 'field_denied',
                field: 'text',
                operationId: 'agent.prompt',
                message: expect.stringContaining('Describe the task in a sentence'),
              },
            },
          })
          expect(f.write).not.toHaveBeenCalled()
          expect(await f.lookup()).toMatchObject({ ok: true, value: { available: false } })
        } finally {
          f.dispose()
        }
      },
    )
  }
}
for (const provider of ['claude-code', 'codex'] as const) {
  it.each(['\t\n ! printenv X', '\r\n /permissions', '\u00a0/approvals', '\ufeff! printenv X'])(
    `${provider} refuses leading-whitespace command input %j`,
    async text => {
      const f = fixture(provider)
      try {
        expect(await probe(f, text)).toMatchObject({
          ok: false,
          error: { code: 'common.forbidden', details: { reason: 'field_denied' } },
        })
        expect(f.write).not.toHaveBeenCalled()
        expect(await f.lookup()).toMatchObject({ value: { available: false } })
      } finally {
        f.dispose()
      }
    },
  )
  for (const caller of ['grant', 'bearer', 'cookie'] as const) {
    const inputs =
      caller === 'grant'
        ? [
            'Refactor',
            'Explain ! printenv X',
            'Explain /permissions',
            'Explain & task',
            'Review this\n/permissions',
            ...(provider === 'codex' ? ['# note'] : []),
          ]
        : prefixes[provider]
    it.each(inputs)(
      `${provider}/${caller} preserves message %j and its existing submission evidence`,
      async text => {
        const f = fixture(provider, caller)
        try {
          const pending = f.send(text)
          await vi.advanceTimersByTimeAsync(300)
          f.observe('UserPromptSubmit', Date.now())
          expect(await pending).toMatchObject({ ok: true, value: { phase: 'submission_observed' } })
          expect(f.write.mock.calls.map(call => call[1])).toEqual([
            `\x1b[200~${text.replace(/\r\n|\r|\n/g, '\r')}\x1b[201~`,
            '\r',
          ])
          expect(await f.lookup()).toMatchObject({
            value: { available: true, status: 'submitted' },
          })
        } finally {
          f.dispose()
        }
      },
    )
  }
}
it.each(['PermissionRequest', 'UserPromptSubmit'])(
  'refuses shell input before ordinary state refusal %s',
  async event => {
    const f = fixture('claude-code')
    try {
      f.observe(event)
      expect(await probe(f, '! printenv X')).toMatchObject({
        ok: false,
        error: { code: 'common.forbidden', details: { reason: 'field_denied' } },
      })
      expect(f.write).not.toHaveBeenCalled()
      expect(await f.lookup()).toMatchObject({ value: { available: false } })
    } finally {
      f.dispose()
    }
  },
)

it.each(['PermissionRequest', 'UserPromptSubmit'])(
  'cannot bypass prefix policy with steering in %s',
  async event => {
    const f = fixture('claude-code')
    try {
      f.observe(event)
      expect(
        await probe(f, '! printenv X', { nodeId: 'n', whenBusy: 'steer', expectTurnId: 'turn' }),
      ).toMatchObject({
        ok: false,
        error: { code: 'common.forbidden', details: { reason: 'field_denied' } },
      })
      expect(f.write).not.toHaveBeenCalled()
      expect(await f.lookup()).toMatchObject({ value: { available: false } })
    } finally {
      f.dispose()
    }
  },
)

it('negative control: Codex receiver selects inline, quoted, escaped and linked skills', () => {
  for (const text of [
    'Use $explain please',
    'Use "$explain" please',
    'Use \\$explain please',
    'Use [$explain](skill://explain) please',
  ]) {
    expect(selectCodexSkills(text)).toEqual(['explain'])
  }
})
