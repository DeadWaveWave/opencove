// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { invoke } from '../../../src/app/cli/core/transport'
import { resolveConnection } from '../../../src/app/cli/core/context'
import { identityFixture } from './cliIdentity.helpers'

it.each([undefined, 'http://fixture', 'http://other'])(
  'never forwards an env token to explicit endpoint %s',
  async envUrl => {
    const f = identityFixture()
    f.io.env.OPENCOVE_CONTROL_URL = envUrl
    await expect(resolveConnection({ endpoint: 'http://other' }, f.io)).rejects.toMatchObject({
      exitCode: 2,
      hint: expect.stringContaining('--token'),
    })
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.io.readTextFile).not.toHaveBeenCalled()
    expect(await resolveConnection({ endpoint: 'http://other', token: 'explicit' }, f.io)).toEqual({
      endpoint: 'http://other',
      token: 'explicit',
    })
  },
)
it('uses only paired credentials and never attaches an unpaired env token during discovery', async () => {
  const f = identityFixture()
  expect(await resolveConnection({}, f.io)).toEqual({ endpoint: 'http://fixture', token: 'secret' })
  delete f.io.env.OPENCOVE_CONTROL_URL
  f.io.profileCandidates = () => ['/isolated']
  f.io.isProcessAlive = () => true
  f.io.readTextFile = async file => {
    if (file.endsWith('worker-control-surface.json')) {
      throw Error('ENOENT')
    }
    return JSON.stringify({
      version: 1,
      hostname: 'localhost',
      port: 4312,
      pid: 42,
      createdAt: new Date().toISOString(),
      token: 'profile-token',
    })
  }
  expect(await resolveConnection({}, f.io)).toMatchObject({ token: 'profile-token' })
  expect(await resolveConnection({ token: 'explicit' }, f.io)).toMatchObject({ token: 'explicit' })
})
it.each([401, 403])('renders a distinct authorization error for status %s', async status => {
  const details = {
    reason: 'operation_denied',
    operationId: 'session.writeNode',
    message: 'session.writeNode is not available to agent terminals: use opencove agent prompt.',
  }
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: status === 401 ? 'control_surface.unauthorized' : 'common.forbidden',
            details,
          },
        }),
        { status },
      ),
  )
  await expect(
    invoke(
      { endpoint: 'http://fixture', token: 'secret' },
      { id: 'session.writeNode', kind: 'command', payload: {} },
      { timeoutMs: 1000, fetch },
    ),
  ).rejects.toMatchObject({
    exitCode: 4,
    message:
      status === 401 ? expect.stringContaining('invalid or has been revoked') : details.message,
  })
})
it('renders field_denied even when the HTTP envelope uses status 200', async () => {
  const details = {
    reason: 'field_denied',
    field: 'agentFullAccess',
    message: 'The user’s configured permission policy always applies.',
  }
  await expect(
    invoke(
      { endpoint: 'http://fixture', token: 'secret' },
      { id: 'session.launchAgent', kind: 'command', payload: {} },
      {
        timeoutMs: 1000,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({ ok: false, error: { code: 'common.forbidden', details } }),
            ),
        ),
      },
    ),
  ).rejects.toMatchObject({ exitCode: 4, message: details.message, details })
})
it.each([true, false])(
  'uses server policy access, with truthful old Worker fallback=%s',
  async old => {
    const f = identityFixture()
    f.values['system.operations'] = old
      ? { operations: [{ id: 'session.writeNode', scope: 'interact' }] }
      : {
          policyVersion: 's1a-v1',
          operations: [
            {
              id: 'session.writeNode',
              scope: 'interact',
              access: 'denied',
              reason: 'Human input only',
            },
            { id: 'session.launchAgent', scope: 'interact', access: 'constrained' },
          ],
        }
    expect(await run(['api', 'ops', '--prefix', 'session'], f.io)).toBe(0)
    const ops = JSON.parse(f.out())
    expect(ops.find((op: { id: string }) => op.id === 'session.writeNode')).toMatchObject(
      old
        ? { access: 'unknown' }
        : { access: 'denied', reason: 'Human input only', policyVersion: 's1a-v1', allowed: false },
    )
    if (old) {
      expect(ops.some((op: object) => Object.hasOwn(op, 'allowed'))).toBe(false)
    } else {
      expect(ops.find((op: { id: string }) => op.id === 'session.launchAgent')).not.toHaveProperty(
        'allowed',
      )
    }
  },
)
it('keeps the offline catalog scope-only with unknown access', async () => {
  const f = identityFixture(false)
  expect(await run(['api', 'ops', '--prefix', 'session'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).every((op: { access: string }) => op.access === 'unknown')).toBe(true)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('uses unknown access when an older Worker refuses introspection', async () => {
  const f = identityFixture()
  f.io.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: false, error: { code: 'common.invalid_input' } })),
  )
  expect(await run(['api', 'ops', '--prefix', 'session'], f.io)).toBe(0)
  expect(JSON.parse(f.out()).every((op: { access: string }) => op.access === 'unknown')).toBe(true)
})
