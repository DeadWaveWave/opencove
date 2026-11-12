import { expect, it } from 'vitest'
import {
  toRendererAppErrorDescriptor,
  reviveRendererAppError,
} from '@shared/errors/rendererAppError'
import { isWorkerConnectionRefusal } from '@shared/sync/managedClaudeWorkerCompatibility'
import { agentPromptErrorPresentation } from '@shared/errors/agentPromptError'
import { agentSpawnErrorPresentation } from '@shared/errors/agentSpawnError'
import { nodeParentErrorPresentation } from '@shared/errors/nodeParentError'

/** Fake credential URLs are assembled at runtime so secret scanners do not flag test fixtures. */
const withUserinfo = (scheme: string, user: string, password: string, rest: string) =>
  `${scheme}${user}:${password}@${rest}`

const snapshot = {
  config: {
    version: 1,
    mode: 'local',
    remote: null,
    webUi: { enabled: true, port: 43211, exposeOnLan: false, passwordSet: false },
    updatedAt: null,
  },
  webAccess: {
    state: 'degraded',
    generation: 2,
    drainingGenerations: [1],
    hostname: '127.0.0.1',
    bindHostname: '127.0.0.1',
    port: 43211,
    passwordRequired: false,
    error: 'SECRET',
  },
}
it.each(['worker.unavailable', 'persistence.io_failed'] as const)(
  'projects a validated local recovery snapshot with catalog prose and no arbitrary nested fields for %s',
  code => {
    const descriptor = toRendererAppErrorDescriptor({
      code,
      details: { configurationSnapshot: { ...snapshot, secret: 'SECRET' }, debug: 'SECRET' },
    })
    expect(descriptor).toMatchObject({
      details: {
        configurationSnapshot: {
          config: snapshot.config,
          webAccess: { ...snapshot.webAccess, error: 'Worker is unavailable.' },
        },
      },
    })
    expect(JSON.stringify(descriptor)).not.toContain('SECRET')
  },
)
it.each([
  {
    ...snapshot,
    config: {
      ...snapshot.config,
      mode: 'remote',
      remote: { hostname: 'example.test', port: 443, token: 'SECRET' },
    },
  },
  {
    ...snapshot,
    webAccess: {
      ...snapshot.webAccess,
      hostname: withUserinfo('https://', 'user', 'SECRET', 'example.test'),
    },
  },
  { ...snapshot, config: { ...snapshot.config, webUi: { ...snapshot.config.webUi, port: -1 } } },
])(
  'omits credential-bearing or malformed snapshots and leaves the refresh fallback available',
  configurationSnapshot => {
    expect(
      toRendererAppErrorDescriptor({
        code: 'worker.unavailable',
        details: { configurationSnapshot },
      }),
    ).toEqual({ code: 'worker.unavailable' })
  },
)
it('preserves refusal reporting through the projected error', () => {
  expect(
    isWorkerConnectionRefusal(
      reviveRendererAppError({
        code: 'agent.managed_launch_rejected',
        details: { reason: 'workerUpgradeRequired' },
      }),
    ),
  ).toBe(true)
  expect(
    isWorkerConnectionRefusal(reviveRendererAppError({ code: 'common.protocol_incompatible' })),
  ).toBe(true)
})
it('preserves validated prompt dispatch flags without creating zero-dispatch evidence', () => {
  const descriptor = toRendererAppErrorDescriptor({
    code: 'agent.busy',
    details: {
      reason: 'competing_input',
      pasteDispatchAttempted: false,
      submitDispatchAttempted: false,
      retryable: false,
    },
  })!
  expect(agentPromptErrorPresentation(descriptor)?.message).toContain(
    'Nothing was sent by this call.',
  )
  const malformed = toRendererAppErrorDescriptor({
    code: 'agent.busy',
    details: { pasteDispatchAttempted: 0, submitDispatchAttempted: 'false' },
  })!
  expect(agentPromptErrorPresentation(malformed)?.message).not.toContain('Nothing was sent')
})
it('preserves spawn and parent reasons while excluding wire-provided prose', () => {
  const spawn = toRendererAppErrorDescriptor({
    code: 'common.forbidden',
    details: {
      reason: 'operation_denied',
      spawnReason: 'caller_node_required',
      message: 'SECRET',
      hint: 'SECRET',
    },
  })!
  expect(agentSpawnErrorPresentation(spawn)?.key).toBe('agentSpawnCaller')
  expect(JSON.stringify(spawn)).not.toContain('SECRET')
  expect(
    nodeParentErrorPresentation(
      toRendererAppErrorDescriptor({
        code: 'node.parent_unavailable',
        details: { reason: 'parent_deleted' },
      })!,
    )?.key,
  ).toBe('nodeParentDeleted')
})
