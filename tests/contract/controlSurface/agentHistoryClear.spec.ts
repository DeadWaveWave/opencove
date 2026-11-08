// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerAgentRunStateHandlers } from '../../../src/app/main/controlSurface/handlers/agentRunStateHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import * as z from 'zod'

function fixture() {
  const f = promptDeliveryRuntimeFixture()
  const surface = createControlSurface()
  registerAgentRunStateHandlers(surface, f.hub)
  const invoke = (
    payload: unknown,
    tier: 'read' | 'interact' = 'interact',
    assertActive?: () => void,
  ) =>
    surface.invoke(
      {
        now: () => new Date(),
        capabilities: {} as ControlSurfaceContext['capabilities'],
        assertActive,
        requestAuth: {
          kind: 'session-grant',
          grant: {
            tier,
            grantId: 'g',
            createdAt: '',
            nodeId: 'sibling',
            sessionId: 'other',
            projectId: 'p',
            spaceId: 'space',
          },
        },
      },
      { kind: 'command', id: 'agent.history.clear', payload },
    )
  return { ...f, invoke }
}

it('requires interact scope before deleting records and allows an authorized sibling', async () => {
  const f = fixture()
  const clear = vi
    .spyOn(f.registry, 'clearHistory')
    .mockReturnValue({ nodeId: 'n', memoryRemoved: 1, archive: { status: 'cleared', removed: 2 } })
  try {
    expect(await f.invoke({ nodeId: 'n' }, 'read')).toMatchObject({
      ok: false,
      error: { code: 'common.forbidden' },
    })
    expect(clear).not.toHaveBeenCalled()
    expect(await f.invoke({ nodeId: 'n' })).toMatchObject({
      ok: true,
      value: { memoryRemoved: 1, archive: { status: 'cleared', removed: 2 } },
    })
    expect(clear).toHaveBeenCalledExactlyOnceWith('n')
  } finally {
    f.dispose()
  }
})

it.each([{}, { nodeId: '' }, { nodeId: '  ' }, { sessionId: 's' }, { nodeId: 'n', all: true }])(
  'rejects invalid history clear input: %j',
  async payload => {
    const f = fixture()
    const clear = vi.spyOn(f.registry, 'clearHistory')
    try {
      expect(await f.invoke(payload)).toMatchObject({
        ok: false,
        error: { code: 'common.invalid_input' },
      })
      expect(clear).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  },
)

it('reports archive unavailability after memory is cleared without changing run state', async () => {
  const f = fixture()
  const before = f.registry.list()
  try {
    expect(await f.invoke({ nodeId: 'n' })).toMatchObject({
      ok: false,
      error: {
        code: 'common.unavailable',
        details: {
          reason: 'archive_unavailable',
          memoryRemoved: 0,
          archive: { status: 'unavailable' },
        },
      },
    })
    expect(f.registry.list()).toEqual(before)
  } finally {
    f.dispose()
  }
})

it('honors revoked credentials before clearing history', async () => {
  const f = fixture()
  const clear = vi.spyOn(f.registry, 'clearHistory')
  try {
    expect(
      await f.invoke({ nodeId: 'n' }, 'interact', () => {
        throw new Error('revoked')
      }),
    ).toMatchObject({ ok: false })
    expect(clear).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

it('exports a described strict node input schema for the interact command', () => {
  const op = getControlSurfaceOperation('agent.history.clear')!
  expect(op).toMatchObject({ kind: 'command', scope: 'interact', contract: 'schema' })
  if (op.contract !== 'schema') {
    throw new Error('schema required')
  }
  const schema = z.toJSONSchema(op.input)
  expect(schema).toMatchObject({
    additionalProperties: false,
    required: ['nodeId'],
    properties: { nodeId: { type: 'string', description: expect.stringContaining('node') } },
  })
})
