// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, project } from './cliIdentity.helpers'

it.each([[], ['--name', 'New name']])(
  'adds a project with persisted output: %j',
  async (...extra) => {
    const f = identityFixture(false)
    const defaultSpace = { id: 'default', name: 'Space 1', rect: null, directoryPath: '/canonical' }
    f.values['project.add'] = {
      projectId: project.id,
      project: { id: project.id, name: 'Existing name', path: '/canonical' },
      space: defaultSpace,
    }
    expect(await run(['project', 'add', '--path', '/input', ...extra], f.io)).toBe(0)
    expect(f.requests.find(r => r.id === 'project.add')?.payload).toEqual({
      path: '/input',
      ...(extra.length ? { name: 'New name' } : {}),
    })
    expect(JSON.parse(f.out())).toEqual({
      id: project.id,
      name: 'Existing name',
      path: '/canonical',
      defaultSpace,
    })
  },
)

it.each([false, true])('presents policy refusal as a final human decision (TTY=%s)', async tty => {
  const f = identityFixture()
  f.io.stderr.isTTY = tty
  let stderr = ''
  f.io.stderr.write = s => {
    stderr += s
  }
  f.fetch.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'common.forbidden',
            details: {
              reason: 'operation_denied',
              operationId: 'project.add',
              message:
                'project.add is not available to agent terminals: this action requires a human decision in OpenCove.',
            },
          },
        }),
        { status: 403 },
      ),
  )
  expect(await run(['project', 'add', '--path', '/repo'], f.io)).toBe(4)
  expect(f.out()).toBe('')
  expect(stderr).toContain('requires a human decision in OpenCove')
  expect(stderr).toContain('Ask the user to add the project in OpenCove')
  // The envelope's retryable:false is fine; the message and hint must not suggest retrying.
  expect(stderr.replace(/"retryable":false/g, '')).not.toMatch(/retry/i)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})

it('preserves unrelated authorization failures', async () => {
  const f = identityFixture(false)
  f.fetch.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'common.unauthorized', debugMessage: 'Token expired' },
        }),
        { status: 401 },
      ),
  )
  expect(await run(['project', 'add', '--path', '/repo'], f.io)).toBe(4)
  expect(f.error().message).toBe('The control token is invalid or has been revoked.')
  expect(f.error().message).not.toContain('human decision')
})

it.each([[], ['--path', '  '], ['--path', '/repo', '--name', ' ']])(
  'rejects invalid project arguments: %j',
  async (...args) => {
    const f = identityFixture(false)
    expect(await run(['project', 'add', ...args], f.io)).toBe(2)
    expect(f.fetch).not.toHaveBeenCalled()
  },
)

it('projects the declared project and default Space fields', async () => {
  const f = identityFixture(false)
  f.values['project.add'] = {
    project: { id: 'p', name: 'App', path: '/app' },
    space: { id: 's', name: 'Space 1', directoryPath: '/app', rect: null },
  }
  expect(
    await run(['project', 'add', '--path', '/app', '--fields', 'id,defaultSpace.id'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ id: 'p', defaultSpace: { id: 's' } })
})

it('prevents a repeated add when an older Worker omits details', async () => {
  const f = identityFixture(false)
  f.values['project.add'] = { projectId: 'p', spaceId: 's', mountId: 'm' }
  expect(await run(['project', 'add', '--path', '/app'], f.io)).toBe(1)
  expect(f.error().hint).toContain('Do not repeat the add command')
  expect(f.requests.filter(r => r.id === 'project.add')).toHaveLength(1)
  expect(f.out()).toBe('')
})
