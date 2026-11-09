// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'

it.each(['allowed', 'denied', 'constrained'])(
  'renders server %s access beside the input schema',
  async access => {
    const f = identityFixture()
    const info = {
      access,
      reason: 'Worker policy reason',
      policyVersion: 'server-test',
      ...(access === 'constrained'
        ? {
            rejectedFields: {
              env: 'Saved environment applies',
              agentFullAccess: 'User permission policy applies',
              executablePathOverride: 'Saved executable applies',
            },
          }
        : {}),
    }
    f.values['system.operation.describe'] = { id: 'session.launchAgent', ...info }
    expect(await run(['api', 'schema', 'session.launchAgent'], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({
      ...info,
      properties: {
        agentFullAccess: expect.any(Object),
        env: expect.any(Object),
        executablePathOverride: expect.any(Object),
      },
    })
    expect(f.requests).toEqual([
      { kind: 'query', id: 'system.operation.describe', payload: { id: 'session.launchAgent' } },
    ])
  },
)
it('projects access and rejected fields without changing the schema command shape', async () => {
  const f = identityFixture()
  f.values['system.operation.describe'] = {
    access: 'constrained',
    policyVersion: 'test',
    rejectedFields: { env: 'Saved environment applies' },
  }
  expect(
    await run(
      ['api', 'schema', 'session.launchAgent', '--fields', 'access,policyVersion,rejectedFields'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    access: 'constrained',
    policyVersion: 'test',
    rejectedFields: { env: 'Saved environment applies' },
  })
})
it('keeps rejected field reasons in the CLI operation catalog too', async () => {
  const f = identityFixture()
  f.values['system.operations'] = {
    policyVersion: 'test',
    operations: [
      {
        id: 'session.launchAgent',
        access: 'constrained',
        rejectedFields: { env: 'Saved environment applies' },
      },
    ],
  }
  expect(
    await run(['api', 'ops', '--prefix', 'session', '--fields', 'id,access,rejectedFields'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toContainEqual({
    id: 'session.launchAgent',
    access: 'constrained',
    rejectedFields: { env: 'Saved environment applies' },
  })
})
it('preserves offline schema exports without connecting', async () => {
  const f = identityFixture(false)
  expect(await run(['api', 'schema', 'session.writeNode'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    type: 'object',
    properties: { data: expect.any(Object) },
  })
  expect(JSON.parse(f.out())).not.toHaveProperty('access')
  expect(f.fetch).not.toHaveBeenCalled()
})
it('keeps variant selection while adding Worker access', async () => {
  const f = identityFixture()
  f.values['system.operation.describe'] = { access: 'allowed', policyVersion: 'test' }
  expect(await run(['api', 'schema', 'node.create', '--variant', 'terminal'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({
    properties: { kind: { const: 'terminal' } },
    access: 'allowed',
    policyVersion: 'test',
  })
})
it.each([false, true])(
  'reports unknown access for an older Worker refusing describe=%s',
  async refuses => {
    const f = identityFixture()
    if (refuses) {
      f.io.fetch = async () =>
        new Response(JSON.stringify({ ok: false, error: { code: 'common.invalid_input' } }))
    } else {
      f.values['system.operation.describe'] = { access: 'allowed' }
    } // Unversioned data is not an access decision.
    expect(await run(['api', 'schema', 'session.writeNode'], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toMatchObject({ type: 'object', access: 'unknown' })
    expect(JSON.parse(f.out())).not.toHaveProperty('allowed')
  },
)
it.each([401, 403])('does not hide HTTP %s behind a local schema', async status => {
  const f = identityFixture()
  f.io.fetch = async () => new Response('{}', { status })
  expect(await run(['api', 'schema', 'session.writeNode'], f.io)).toBe(4)
  expect(f.out()).toBe('')
})
