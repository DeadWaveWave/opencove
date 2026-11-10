// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fallbackFaultHarness } from './managedClaudeFallbackFaultHarness'
import type { ShellCase } from './managedClaudeFallbackFaultCases'
import { ManagedClaudeLaunchOwner as Owner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { ManagedClaudeFallbackCustody as Custody } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeFallbackCustody'
import { ManagedClaudeRuntimeCleanup as Cleanup } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRuntimeCleanup'
import type { ManagedClaudeLaunchPorts } from '../../../src/contexts/agent/application/managedClaudeLaunch/ports'
import { createAppError } from '../../../src/shared/errors/appError'
import type { ManagedClaudeAttemptEffects } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeAttemptEffects'

vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentLaunchSpawnResolver', () => ({
  resolveAgentLaunchSpawn: async (input: object) => ({
    ...input,
    profileId: null,
    runtimeKind: 'posix',
  }),
}))
vi.mock('../../../src/platform/terminal/TerminalProfileResolver', () => ({
  TerminalProfileResolver: class {
    async resolveTerminalSpawn() {
      throw new Error('unconfigured profile')
    }
  },
}))
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const baseline: ShellCase = {
  route: 'plain',
  mode: 'stopped',
  handoff: 'hold',
  fault: 'none',
  event: 'none',
  edge: 'shellProfile:before',
}
it('detects a replacement that fails instead of acquiring the node', async () => {
  await detected(
    { event: 'replace', edge: 'shellProfile:after' },
    f => {
      f.runtime().run = async () => {
        throw createAppError('agent.launch_failed')
      }
    },
    ['outcome: expected independent peer success'],
  )
})
type Harness = Awaited<ReturnType<typeof fallbackFaultHarness>>
async function detected(
  config: Partial<ShellCase>,
  mutation: (f: Harness) => void,
  failures: string[],
) {
  const f = await fallbackFaultHarness({ ...baseline, ...config })
  try {
    mutation(f)
    f.start()
    await f.settle()
    const violations = f.models.flatMap(value => value.violations).join('\n')
    for (const failure of failures) {
      expect(violations).toContain(failure)
    }
  } finally {
    f.dispose()
  }
}

it('detects a returned shell without persistence custody', async () => {
  await detected(
    {},
    () => {
      vi.spyOn(Owner.prototype, 'retainFallbackRuntime').mockResolvedValue()
    },
    ['fallback outcome: returned shell is not alive'],
  )
})
it('detects retiring an earlier fallback before its successor is durably handed off', async () => {
  await detected(
    { event: 'prepare', edge: 'shellReturn:after' },
    () => {
      const retain = Owner.prototype.retainFallbackRuntime
      vi.spyOn(Owner.prototype, 'retainFallbackRuntime').mockImplementation(
        async function (attempt, id) {
          await (
            this as unknown as { effects: ManagedClaudeAttemptEffects }
          ).effects.cleanupPrevious(attempt, true)
          return retain.call(this, attempt, id)
        },
      )
    },
    ['fallback outcome: shell retired before persistence handoff'],
  )
})
it('detects a shell omitted from early registration-failure custody', async () => {
  await detected(
    { fault: 'registration' },
    () => {
      vi.spyOn(Owner.prototype, 'trackCreatedRuntime').mockImplementation(() => {})
    },
    ['missing cleanup'],
  )
})
it('detects deletion that fails to release fallback custody', async () => {
  await detected(
    { event: 'delete', edge: 'shellReturn:before' },
    () => {
      vi.spyOn(Custody.prototype, 'release').mockImplementation(() => {})
    },
    ['cleanup did not converge'],
  )
})
it('detects persistence handoff that never acknowledges the proven reference', async () => {
  await detected(
    { handoff: 'persist' },
    () => {
      vi.spyOn(Custody.prototype, 'observeReferences').mockImplementation(() => {})
    },
    ['cleanup did not converge'],
  )
})
it.each(
  (['plain', 'mount'] as const).flatMap(route =>
    (['newer', 'delete'] as const).map(event => ({ route, event })),
  ),
)(
  'detects a stale shell start through the $route PTY route after $event',
  async ({ route, event }) => {
    await detected(
      { route, event, edge: 'shellActivity:after' },
      () => {
        vi.spyOn(Owner.prototype, 'assertCurrent').mockImplementation(() => {})
      },
      ['shell started after supersession or deletion'],
    )
  },
)
it('detects shell cleanup that gives up after a failed kill', async () => {
  await detected(
    { event: 'delete', edge: 'shellReturn:before', fault: 'cleanupKill' },
    () => {
      vi.spyOn(
        Cleanup.prototype as unknown as { retry(id: string): void },
        'retry',
      ).mockImplementation(() => {})
    },
    ['cleanup did not converge'],
  )
})
it('detects reference handoff that kills a referenced shell', async () => {
  await detected(
    { handoff: 'persist' },
    f => {
      const original = f.runtime().owner.observeFallbackReferences
      f.runtime().owner.observeFallbackReferences = () => {
        const owner = f.runtime().owner
        const ports = (owner as unknown as { ports: ManagedClaudeLaunchPorts }).ports
        for (const id of owner.pendingCleanupRuntimeIds()) {
          if (ports.isRuntimeReferenced(id)) {
            void ports.killExactRuntime(id)
          }
        }
        original()
      }
    },
    ['referenced kill', 'dead/foreign reference'],
  )
})
it('detects duplicate successful shell kills', async () => {
  await detected(
    { event: 'delete', edge: 'shellReturn:before' },
    f => {
      const ports = (f.runtime().owner as unknown as { ports: ManagedClaudeLaunchPorts }).ports
      const kill = ports.killExactRuntime
      ports.killExactRuntime = async id => {
        await kill(id)
        await kill(id)
      }
    },
    ['duplicate successful kill'],
  )
})
it('detects foreign shell results and a corrupted fallback tuple/receipt', async () => {
  await detected(
    {},
    f => {
      const run = f.runtime().withPreparation
      f.runtime().withPreparation = async (...args) => {
        const value = (await run(...args)) as { managedClaudeLifecycle: { binding: object } }
        return {
          ...value,
          sessionId: 'peer-original',
          agent: { resumeSessionId: 'foreign' },
          managedClaudeLifecycle: {
            ...value.managedClaudeLifecycle,
            binding: {
              ...value.managedClaudeLifecycle.binding,
              tuple: { resumeSessionId: 'foreign', resumeSessionIdVerified: true },
            },
          },
        } as never
      }
    },
    [
      'fallback outcome: wrong runtime kind',
      'fallback outcome: foreign runtime',
      'fallback outcome: wrong tuple',
      'fallback outcome: wrong settlement receipt',
    ],
  )
})
it('detects a healthy fallback command changed into an empty failure result', async () => {
  await detected(
    {},
    f => {
      const run = f.runtime().withPreparation
      f.runtime().withPreparation = async (...args) =>
        ({ ...((await run(...args)) as object), sessionId: '' }) as never
    },
    ['fallback outcome: wrong runtime kind', 'fallback outcome: returned shell is not alive'],
  )
})
