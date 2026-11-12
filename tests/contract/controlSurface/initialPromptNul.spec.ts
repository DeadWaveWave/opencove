// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { createPromptWorker, cwd, rootUri } from './sessionGrantPromptLiteral.testUtils'

const remote = vi.hoisted(() => vi.fn())
vi.mock('../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient', () => ({
  invokeControlSurface: remote,
}))
afterEach(() => vi.clearAllMocks())

for (const route of ['direct', 'mount', 'node', 'mounted-node', 'remote', 'remote-node'] as const) {
  for (const trusted of [false, true]) {
    it.each(AGENT_PROVIDER_IDS)(
      `${route}/trusted=${trusted}/%s refuses NUL before launch effects`,
      async provider => {
        const f = await createPromptWorker({
          remote: route.startsWith('remote'),
          localMount: route === 'mounted-node',
          fullAccess: false,
        })
        const before = await f.store.readAppState()
        const prompt = 'plugins\0 explain this project'
        const node = route.endsWith('node')
        try {
          const result = await f.invoke(
            {
              kind: 'command',
              id: node
                ? 'node.create'
                : route === 'direct'
                  ? 'session.launchAgent'
                  : 'session.launchAgentInMount',
              payload: node
                ? {
                    kind: 'agent',
                    space: { kind: 'spaceId', spaceId: 'space' },
                    data: { provider, prompt },
                  }
                : {
                    ...(route === 'direct' ? { cwd } : { mountId: 'mount', cwdUri: rootUri }),
                    provider,
                    prompt,
                  },
            },
            trusted,
          )
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'common.invalid_input',
              details: { reason: 'initial_prompt_contains_nul' },
            },
          })
          expect(f.spawn).not.toHaveBeenCalled()
          expect(f.kill).not.toHaveBeenCalled()
          expect(remote).not.toHaveBeenCalled()
          expect(await f.store.readAppState()).toEqual(before)
        } finally {
          await f.dispose()
        }
      },
    )
  }
}
