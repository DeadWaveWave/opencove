// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { commands } from '../../../src/app/cli/commands'
import { identityFixture, who, project, space, node } from './cliIdentity.helpers'

it.each([true, false])('shows safe whoami fields inside=%s', async inside => {
  const f = identityFixture(inside)
  f.values['system.whoami'] = { ...(f.values['system.whoami'] as object), token: 'do-not-print' }
  expect(await run(['whoami'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual(
    inside
      ? {
          caller: 'session-grant',
          scope: 'interact',
          projectId: who.projectId,
          spaceId: who.spaceId,
          nodeId: who.nodeId,
          sessionId: who.sessionId,
        }
      : {
          caller: 'bearer',
          scope: 'admin',
          projectId: null,
          spaceId: null,
          nodeId: null,
          sessionId: null,
        },
  )
  expect(f.requests).toMatchObject([{ id: 'system.whoami', payload: {} }])
  expect(f.out()).not.toContain('do-not-print')
})

for (const [kind, args, id, name, operation, key] of [
  ['node', ['node', 'get'], node.id, node.title, 'node.get', 'nodeId'],
  ['space', ['space', 'get'], space.id, space.name, 'space.get', 'spaceId'],
  ['project', ['mount', 'list'], project.id, project.name, 'mount.list', 'projectId'],
] as const) {
  it.each(['@self', id, name, id.slice(0, 8)])(`resolves ${kind} selector %s`, async selector => {
    const f = identityFixture()
    expect(await run([...args, `--${kind}`, selector], f.io), JSON.stringify(f.requests)).toBe(0)
    expect(f.requests.at(-1)).toMatchObject({ id: operation, payload: { [key]: id } })
    expect(f.requests.filter(request => request.id === `${kind}.list`).length).toBeLessThanOrEqual(
      1,
    )
  })
  it.each(['missing', id.slice(0, 5), name.toUpperCase()])(
    `reports ${kind} not found: %s`,
    async selector => {
      const f = identityFixture()
      const rejected =
        kind === 'node'
          ? ['node', 'delete']
          : kind === 'space'
            ? ['worktree', 'archive']
            : [...args]
      expect(await run([...rejected, `--${kind}`, selector], f.io)).toBe(1)
      expect(f.error()).toMatchObject({
        code: `${kind}.not_found`,
        message: expect.stringContaining('was not found'),
        hint: expect.stringContaining(`opencove ${kind} list`),
      })
      const mutation =
        kind === 'node' ? 'node.delete' : kind === 'space' ? 'worktree.archive' : operation
      expect(f.requests.some(request => request.id === mutation)).toBe(false)
    },
  )
  it(`caps ${kind} ambiguity candidates at ten`, async () => {
    const f = identityFixture()
    f.values[`${kind}.list`] = {
      [`${kind === 'space' ? 'spaces' : kind + 's'}`]: Array.from({ length: 12 }, (_, i) => ({
        id: `abcdef-${i}`,
        kind,
        title: 'Same',
        name: 'Same',
        spaceId: 's',
      })),
    }
    const rejected =
      kind === 'node' ? ['node', 'delete'] : kind === 'space' ? ['worktree', 'archive'] : [...args]
    expect(await run([...rejected, `--${kind}`, 'abcdef'], f.io)).toBe(6)
    expect(f.error()).toMatchObject({ code: 'cli.ambiguous', hint: expect.stringContaining('ID') })
    expect(f.error().details.candidates).toHaveLength(10)
    expect(f.error().details.candidates[0]).toEqual({
      id: 'abcdef-0',
      kind,
      [kind === 'node' ? 'title' : 'name']: 'Same',
      spaceId: 's',
    })
    const mutation =
      kind === 'node' ? 'node.delete' : kind === 'space' ? 'worktree.archive' : operation
    expect(f.requests.some(request => request.id === mutation)).toBe(false)
  })
  it(`rejects ${kind} @self for a desktop token`, async () => {
    const f = identityFixture(false)
    expect(await run([...args, `--${kind}`, '@self'], f.io)).toBe(2)
    expect(f.error()).toMatchObject({
      message: expect.stringContaining('only works inside an OpenCove terminal'),
      hint: expect.stringContaining('OPENCOVE_NODE_ID'),
    })
    const mutation =
      kind === 'node' ? 'node.delete' : kind === 'space' ? 'worktree.archive' : operation
    expect(f.requests.some(request => request.id === mutation)).toBe(false)
  })
  it(`falls back to whoami for token-only ${kind} @self`, async () => {
    const f = identityFixture()
    f.io.env = { OPENCOVE_CONTROL_URL: 'http://fixture', OPENCOVE_CONTROL_TOKEN: 'secret' }
    expect(await run([...args, `--${kind}`, '@self'], f.io)).toBe(0)
    expect(f.requests.filter(r => r.id === 'system.whoami')).toHaveLength(1)
    expect(f.requests.at(-1)).toMatchObject({ id: operation, payload: { [key]: id } })
  })
  it(`prefers exact ${kind} ID, then exact name, over prefix`, async () => {
    const f = identityFixture()
    const listKey = kind === 'space' ? 'spaces' : `${kind}s`
    f.values[`${kind}.list`] = {
      [listKey]: [
        { id: 'abcdef', title: 'Other', name: 'Other' },
        { id: 'chosen', title: 'abcdef', name: 'abcdef' },
        { id: 'abcdef-other', title: 'Other', name: 'Other' },
      ],
    }
    expect(await run([...args, `--${kind}`, 'abcdef'], f.io)).toBe(0)
    expect(f.requests.at(-1)?.payload[key]).toBe('abcdef')
    const g = identityFixture()
    g.values[`${kind}.list`] = {
      [listKey]: [
        { id: 'chosen', title: 'abcdef', name: 'abcdef' },
        { id: 'abcdef-other', title: 'Other', name: 'Other' },
      ],
    }
    expect(await run([...args, `--${kind}`, 'abcdef'], g.io)).toBe(0)
    expect(g.requests.at(-1)?.payload[key]).toBe('chosen')
  })
}

it.each(['node', 'space', 'project'])('accepts short exact %s IDs and names', async kind => {
  const f = identityFixture()
  const listKey = kind === 'space' ? 'spaces' : `${kind}s`
  f.values[`${kind}.list`] = { [listKey]: [{ id: 'abc', name: 'xyz', title: 'xyz' }] }
  const args =
    kind === 'node' ? ['node', 'get'] : kind === 'space' ? ['space', 'get'] : ['mount', 'list']
  expect(await run([...args, `--${kind}`, 'xyz'], f.io)).toBe(0)
  expect(Object.values(f.requests.at(-1)!.payload)).toContain('abc')
})

it.each([true, false])('applies defaults only inside OpenCove: %s', async inside => {
  const f = identityFixture(inside)
  expect(await run(['space', 'get'], f.io)).toBe(inside ? 0 : 2)
  if (inside) {
    expect(f.requests.at(-1)).toMatchObject({ payload: { spaceId: space.id } })
  }
  const g = identityFixture(inside)
  expect(await run(['mount', 'list'], g.io)).toBe(inside ? 0 : 2)
  const n = identityFixture(inside)
  expect(await run(['node', 'delete'], n.io)).toBe(2)
  expect(n.fetch).not.toHaveBeenCalled()
})

it('uses the session project for names and an explicit project overrides it', async () => {
  const f = identityFixture()
  expect(await run(['node', 'get', '--node', 'Shell'], f.io)).toBe(0)
  expect(f.requests[0]).toMatchObject({ id: 'node.list', payload: { projectId: project.id } })
  const g = identityFixture()
  g.values['project.list'] = { projects: [{ ...project, id: 'other', name: 'Other' }] }
  expect(await run(['node', 'get', '--node', 'Shell', '--project', 'Other'], g.io)).toBe(0)
  expect(g.requests.find(r => r.id === 'node.list')?.payload).toEqual({ projectId: 'other' })
})

it('keeps explicit locators rather than adding a default space', async () => {
  const f = identityFixture()
  expect(await run(['node', 'list', '--space-name', 'Main'], f.io)).toBe(0)
  expect(f.requests.at(-1)?.payload.space).toEqual({
    kind: 'spaceName',
    name: 'Main',
    projectId: project.id,
  })
})

it('adds selector metadata to every target option, including plugin targets', () => {
  for (const command of commands) {
    for (const [key, spec] of Object.entries(command.options ?? {})) {
      if (['node', 'space', 'project'].includes(key)) {
        expect(spec.selector).toBe(key)
      }
    }
  }
})

it('rejects @self outside OpenCove without trying profile discovery', async () => {
  const f = identityFixture(false)
  f.io.env = {}
  expect(await run(['node', 'get', '--node', '@self'], f.io)).toBe(2)
  expect(f.error().hint).toContain('OPENCOVE_PROJECT_ID')
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
})

it('does not treat identity variables alone as permission to use @self', async () => {
  const f = identityFixture(false)
  f.io.env.OPENCOVE_NODE_ID = node.id
  expect(await run(['node', 'get', '--node', '@self'], f.io)).toBe(2)
})

it('uses one whoami fallback for multiple missing environment identities', async () => {
  const f = identityFixture()
  delete f.io.env.OPENCOVE_PROJECT_ID
  delete f.io.env.OPENCOVE_SPACE_ID
  expect(await run(['node', 'create', 'note'], f.io)).toBe(0)
  expect(f.requests.filter(request => request.id === 'system.whoami')).toHaveLength(1)
  expect(f.requests.at(-1)).toMatchObject({
    payload: { space: { kind: 'spaceId', spaceId: space.id } },
  })
})

it.each(['node', 'space'])(
  'reads an exact %s UUID across projects without an active-project list',
  async kind => {
    const f = identityFixture(false)
    const uuid = '00000000-0000-4000-8000-000000000000'
    f.values[`${kind}.get`] = { [kind]: { id: uuid }, projectId: 'another-project' }
    f.values[`${kind}.list`] = { [kind === 'space' ? 'spaces' : 'nodes']: [] }
    expect(await run([kind, 'get', `--${kind}`, uuid], f.io)).toBe(0)
    expect(f.requests.some(request => request.id === `${kind}.list`)).toBe(false)
  },
)

const targets = commands.flatMap(command =>
  Object.entries(command.options ?? {})
    .filter(([, spec]) => spec.selector)
    .flatMap(([flag, spec]) =>
      ['self', 'id', 'name', 'prefix'].map(form => ({ command, flag, kind: spec.selector!, form })),
    ),
)
it.each(targets)(
  'resolves $command.path --$flag using $form through run()',
  async ({ command, flag, kind, form }) => {
    const f = identityFixture()
    f.values['agent.list'] = { epoch: 'e', seq: 1, agents: [] }
    f.values['session.finalMessage'] = { sessionId: 's', message: 'Done' }
    f.values['agent.get'] = {
      nodeId: node.id,
      sessionId: 's',
      provider: 'claude-code',
      state: 'idle',
      blockedReason: null,
      turn: null,
      lastTransitionAt: 1,
      source: 'claude_hook',
      quality: 'authoritative',
      turnOutcome: null,
    }
    const target = {
      node: { id: node.id, name: node.title },
      space: { id: space.id, name: space.name },
      project: { id: project.id, name: project.name },
    }[kind]
    const value =
      form === 'self'
        ? '@self'
        : form === 'id'
          ? target.id
          : form === 'name'
            ? target.name
            : target.id.slice(0, 8)
    const args = [...command.path, ...(command.positionals ?? []).map(() => 'sample')]
    for (const [key, spec] of Object.entries(command.options ?? {})) {
      if (key === flag) {
        continue
      }
      if (spec.required) {
        args.push(
          `--${key}`,
          spec.selector
            ? '@self'
            : key === 'url'
              ? 'https://example.com'
              : key === 'root-path'
                ? '/repo'
                : Array.isArray(spec.choices)
                  ? spec.choices[0]
                  : 'sample',
        )
      }
    }
    if (command.targetSpace === 'required' && flag === 'project') {
      args.push('--space', '@self')
    }
    if (command.path.join(' ') === 'agent prompt') {
      // Its text source is one of two options, so neither is marked required.
      args.push('--text', 'sample')
      f.values['agent.prompt'] = {
        deliveryId: 'delivery',
        nodeId: node.id,
        sessionId: 'session',
        phase: 'submission_observed',
        turnId: 'turn',
      }
    }
    args.push(`--${flag}`, value)
    expect(await run(args, f.io), JSON.stringify(f.requests)).toBe(0)
    expect(f.requests.filter(request => request.id === `${kind}.list`).length).toBeLessThanOrEqual(
      1,
    )
    // No symbolic selector may cross the CLI boundary into an operation payload.
    expect(JSON.stringify(f.requests.map(request => request.payload))).not.toContain('@self')
  },
)

it.each(['node', 'space'])(
  'prefers an exact legacy %s ID in another project over a local name',
  async kind => {
    const f = identityFixture(false)
    const legacyId = 'legacy-id'
    f.values[`${kind}.get`] = { [kind]: { id: legacyId }, projectId: 'another-project' }
    f.values[`${kind}.list`] = {
      [kind === 'space' ? 'spaces' : 'nodes']: [{ id: 'local', title: legacyId, name: legacyId }],
    }
    expect(await run([kind, 'get', `--${kind}`, legacyId], f.io)).toBe(0)
    expect(JSON.parse(f.out())[kind].id).toBe(legacyId)
    expect(f.requests.filter(request => request.id === `${kind}.list`)).toHaveLength(1)
    expect(f.requests.filter(request => request.id === `${kind}.get`)).toHaveLength(1)
  },
)
