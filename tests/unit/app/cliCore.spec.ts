// @vitest-environment node
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'
import { describe, it, expect, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import type { CliIo } from '../../../src/app/cli/core/io'
import { commands } from '../../../src/app/cli/commands'
import { CliError } from '../../../src/app/cli/core/errors'
import { createControlToken } from '../../../src/app/main/controlSurface/http/createControlToken'
function fixture(value: unknown = { pong: true }) {
  let stdout = '',
    stderr = ''
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, value })))
  const io: CliIo = {
    stdout: {
      write(s) {
        stdout += s
      },
    },
    stderr: {
      write(s) {
        stderr += s
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://localhost:1', OPENCOVE_CONTROL_TOKEN: 'token' },
    fetch,
    now: Date.now,
    readTextFile: vi.fn(async () => {
      throw Error('missing')
    }),
    readStdinText: vi.fn(async () => '- raw \n'),
    profileCandidates: () => ['/a', '/b'],
    isProcessAlive: () => true,
  }
  return { io, fetch, out: () => stdout, err: () => stderr }
}
const file = JSON.stringify({
  version: 1,
  hostname: 'localhost',
  port: 123,
  token: 'file',
  pid: 123,
  createdAt: '2026-01-01',
  startedBy: 'cli',
})
describe('TypeScript CLI core', () => {
  it.each([
    [],
    ['--help'],
    ['node', '--help'],
    ['node', 'create', 'note', '--help'],
    ['task', 'claim', '--help'],
    ['task', 'release', '--help'],
    ['note', 'append', '--help'],
  ])('help snapshot %j', async (...items) => {
    const args = items as string[]
    const f = fixture()
    expect(await run(args, f.io)).toBe(args.length ? 0 : 2)
    expect(f.out()).toMatchSnapshot()
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['nodes', 'list'],
    ['ping', '--unknown'],
    ['node', 'get'],
    ['node', 'create', 'note', '--space', 's', '--text'],
    ['node', 'create', 'note', '--space', 's', '--text=x', '--text-file', '-'],
    ['ping', '--timeout', '0'],
  ])('usage has no IO %j', async (...items) => {
    const f = fixture()
    expect(await run(items as string[], f.io)).toBe(2)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.io.readTextFile).not.toHaveBeenCalled()
    expect(f.out()).toBe('')
  })
  it('suggests unknown command', async () => {
    const f = fixture()
    await run(['nodes', 'list'], f.io)
    expect(f.err()).toContain('node list')
    expect(f.err()).not.toContain('Usage:')
  })
  it('uses explicit endpoint/token over environment and files', async () => {
    const f = fixture()
    expect(await run(['--endpoint', 'http://localhost:2', 'ping', '--token=--opaque'], f.io)).toBe(
      0,
    )
    expect(f.fetch.mock.calls[0][0]).toBe('http://localhost:2/invoke')
    expect(f.io.readTextFile).not.toHaveBeenCalled()
    expect(f.out()).toBe('{"pong":true}\n')
    expect(f.err()).toBe('')
  })
  it('accepts a generated token in the documented --token <value> form', async () => {
    const token = createControlToken(() => Buffer.alloc(32, 0xf8))
    const f = fixture()

    const code = await run(['ping', '--endpoint', 'http://localhost:2', '--token', token], f.io)

    expect(code, f.err()).toBe(0)
    expect(f.fetch).toHaveBeenCalledWith(
      'http://localhost:2/invoke',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
      }),
    )
    expect(f.out()).toBe('{"pong":true}\n')
    expect(f.err()).toBe('')
  })
  it('uses environment ahead of profile', async () => {
    const f = fixture()
    await run(['ping', '--user-data', '/x'], f.io)
    expect(f.io.readTextFile).not.toHaveBeenCalled()
  })
  it('uses explicit profile ahead of environment profile', async () => {
    const f = fixture()
    f.io.env = { OPENCOVE_USER_DATA_DIR: '/b' }
    f.io.readTextFile = vi.fn(async p => {
      if (p === '/a/control-surface.json') {
        return file
      }
      throw Error()
    })
    expect(await run(['ping', '--user-data', '/a'], f.io)).toBe(0)
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it('reports all live candidates without credentials', async () => {
    const f = fixture()
    f.io.env = {}
    f.io.readTextFile = async () => file
    expect(await run(['ping'], f.io)).toBe(6)
    expect(f.err()).toContain('context.ambiguous')
    expect(f.err()).toContain('startedBy')
    expect(f.err()).not.toContain('"token"')
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it('ignores stale files', async () => {
    const f = fixture()
    f.io.env = {}
    f.io.readTextFile = async () => file
    f.io.isProcessAlive = () => false
    expect(await run(['ping'], f.io)).toBe(3)
  })
  it.each([401, 403])('auth %i', async status => {
    const f = fixture()
    f.fetch.mockImplementation(async () => new Response('', { status }))
    expect(await run(['ping'], f.io)).toBe(4)
  })
  it.each([
    ['common.protocol_incompatible', 5],
    ['node.not_found', 1],
  ])('server error %s', async (code, exit) => {
    const f = fixture()
    f.fetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: false, error: { code, debugMessage: 'debug' } })),
    )
    expect(await run(['ping'], f.io)).toBe(exit)
    expect(f.err()).toContain('debug')
    expect(f.out()).toBe('')
  })
  it('refused connection', async () => {
    const f = fixture()
    f.fetch.mockRejectedValue(new TypeError('refused'))
    expect(await run(['ping'], f.io)).toBe(3)
  })
  it('times out and clears resources', async () => {
    const f = fixture()
    f.io.fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(Error('abort'))),
        ),
    )
    expect(await run(['ping', '--timeout', '1'], f.io)).toBe(124)
  })
  it('TTY error format', async () => {
    const f = fixture()
    f.io.stderr.isTTY = true
    await run(['nodes', 'list'], f.io)
    expect(f.err()).toMatch(/^error\[cli.usage\]:/)
    expect(f.err()).toContain('  hint:')
  })
  it('explicit JSON overrides TTY', async () => {
    const f = fixture()
    f.io.stderr.isTTY = true
    await run(['nodes', 'list', '-o', 'json'], f.io)
    expect(JSON.parse(f.err()).error.code).toBe('cli.usage')
  })
  it.each([['--text=-value'], ['--text-file', '-']])('preserves text %j', async (...args) => {
    const f = fixture()
    expect(await run(['node', 'create', 'note', '--space', 's', ...(args as string[])], f.io)).toBe(
      0,
    )
    const body = JSON.parse(
      String((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    )
    expect(body.payload.data.text).toBe(args[0] === '--text=-value' ? '-value' : '- raw \n')
  })
  it('does not treat option values as global flags', async () => {
    const f = fixture()
    expect(await run(['node', 'create', 'note', '--space', 's', '--text=--help'], f.io)).toBe(0)
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })
  it('projects list dot fields', async () => {
    const f = fixture({ projects: [{ id: '1', name: 'N', secret: 1 }] })
    await run(['project', 'list', '--fields', 'id,name'], f.io)
    expect(JSON.parse(f.out())).toEqual({ projects: [{ id: '1', name: 'N' }] })
  })
  it('rejects unmatched fields', async () => {
    const f = fixture({ projects: [{ id: '1' }] })
    expect(await run(['project', 'list', '--fields', 'missing'], f.io)).toBe(2)
    expect(f.err()).toContain('Available fields: id')
  })
  it('renders table', async () => {
    const f = fixture({ projects: [{ id: '1', name: 'N' }] })
    await run(['project', 'list', '-o', 'table'], f.io)
    expect(f.out()).toBe('ID  NAME\n1   N\n')
  })
  it.each(['node.create', 'system.operations', 'system.operation.describe'])(
    'schema %s offline',
    async id => {
      const f = fixture()
      expect(await run(['api', 'schema', id], f.io)).toBe(0)
      expect(JSON.parse(f.out())[id === 'node.create' ? 'oneOf' : 'type']).toEqual(
        id === 'node.create' ? expect.any(Array) : 'object',
      )
      expect(f.fetch).not.toHaveBeenCalled()
    },
  )
  it('legacy schema error', async () => {
    const f = fixture()
    // Any operation still on the legacy contract has no input schema to print.
    const legacy = CONTROL_SURFACE_OPERATIONS.find(op => op.contract === 'legacy')
    expect(legacy).toBeDefined()
    expect(await run(['api', 'schema', legacy!.id], f.io)).toBe(1)
    expect(f.err()).toContain('api.schema_unavailable')
  })
  it('routes session through the core', async () => {
    const f = fixture()
    expect(await run(['session', 'get', '--session', 'id'], f.io)).toBe(0)
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({
      kind: 'query',
      id: 'session.get',
      payload: { sessionId: 'id' },
    })
  })
})

it('maps interruption to 130', async () => {
  const f = fixture()
  const controller = new AbortController()
  f.io.signal = controller.signal
  controller.abort()
  expect(await run(['ping'], f.io)).toBe(130)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('explicit JSON formats command parse errors on TTY', async () => {
  const f = fixture()
  f.io.stderr.isTTY = true
  expect(await run(['ping', '-o', 'json', '--wat'], f.io)).toBe(2)
  expect(JSON.parse(f.err()).error.code).toBe('cli.usage')
})
it('api call delegates input validation to the server', async () => {
  const f = fixture()
  expect(
    await run(
      [
        'api',
        'call',
        'node.create',
        '--input',
        '{"kind":"note","space":{"kind":"spaceId","spaceId":""}}',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.fetch).toHaveBeenCalledTimes(1)
  expect(f.io.readTextFile).not.toHaveBeenCalled()
})
it('supports end of options for positional operation IDs', async () => {
  const f = fixture()
  expect(await run(['api', 'schema', '--', 'system.operations'], f.io)).toBe(0)
})

it.each([
  [['--space', 's'], { kind: 'spaceId', spaceId: 's' }],
  [['--space-name', 'Name', '--project', 'p'], { kind: 'spaceName', name: 'Name', projectId: 'p' }],
  [['--worker', 'w', '--branch', 'main'], { kind: 'workerBranch', worker: 'w', branch: 'main' }],
  [['--worker', 'w', '--path', '/repo'], { kind: 'workerPath', worker: 'w', path: '/repo' }],
])('preserves space locator %j', async (flags, locator) => {
  const f = fixture()
  expect(await run(['canvas', 'focus', 'space', ...(flags as string[])], f.io)).toBe(0)
  const call = f.fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(call[1].body)).payload.target.locator).toEqual(locator)
})
it.each([
  ['--space', 's', '--space-name', 'Name'],
  ['--worker', 'w'],
  ['--branch', 'main'],
])('rejects invalid locator %j', async (...flags) => {
  const f = fixture()
  expect(await run(['node', 'list', ...flags], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('status invokes only capabilities with protocol header', async () => {
  const f = fixture({ protocolVersion: 1, appVersion: 'test', instanceId: 'instance' })
  expect(await run(['status', '--pretty'], f.io)).toBe(0)
  expect(f.fetch).toHaveBeenCalledTimes(1)
  const call = f.fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(call[1].headers).toHaveProperty('x-opencove-protocol')
  expect(JSON.parse(String(call[1].body)).id).toBe('system.capabilities')
  expect(f.out()).toContain('\n  "appVersion"')
})
it('reads API input from a file and invokes validated operation', async () => {
  const f = fixture()
  f.io.readTextFile = vi.fn(async () => '{"id":"node.create"}')
  expect(
    await run(['api', 'call', 'system.operation.describe', '--input-file', 'payload.json'], f.io),
  ).toBe(0)
  expect(f.io.readTextFile).toHaveBeenCalledWith('payload.json')
})
it('filters local registry offline', async () => {
  const f = fixture()
  expect(await run(['api', 'ops', '--contract', 'schema', '--kind', 'query'], f.io)).toBe(0)
  const ops = JSON.parse(f.out()) as Array<{ id: string; kind: string; contract: string }>
  expect(ops.length).toBeGreaterThan(0)
  expect(ops.every(op => op.kind === 'query' && op.contract === 'schema')).toBe(true)
  expect(ops.map(op => op.id)).toEqual(
    expect.arrayContaining(['system.operations', 'system.operation.describe', 'node.list']),
  )
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([
  ['node', 'create', 'note', '--space', 's', '--text', 'hello'],
  ['node', 'delete', '--node', 'n'],
  ['api', 'call', 'node.delete', '--input', '{"nodeId":"n"}'],
])('rejects unsupported table before mutation %j', async (...args) => {
  const f = fixture()
  expect(await run([...args, '-o', 'table'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
  expect(f.out()).toBe('')
  expect(f.err()).toContain('Table output is unavailable')
})

it.each([
  ['node', 'delete', '--node', 'n', '--fields', 'deleted'],
  ['canvas', 'focus', 'node', '--node', 'n', '--fields', 'id'],
  ['api', 'call', 'node.delete', '--input', '{"nodeId":"n"}', '--fields', 'deleted'],
  ['api', 'call', 'session.kill', '--input', '{"sessionId":"s"}', '--fields='],
])('rejects invalid mutation projections before invoking %j', async (...args) => {
  const f = fixture({ node: { id: 'created-node' } })
  expect(await run(args, f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.io.readTextFile).not.toHaveBeenCalled()
  expect(f.out()).toBe('')
  expect(f.err()).toContain(
    args[0] === 'api' ? '--fields is unavailable for mutation operations' : 'Unknown fields:',
  )
})
it('keeps api query projections available', async () => {
  const f = fixture({ node: { id: 'n', title: 'note' } })
  expect(
    await run(
      ['api', 'call', 'node.get', '--input', '{"nodeId":"n"}', '--fields', 'node.id'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ node: { id: 'n' } })
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('returns exit 6 for an ambiguous space locator and preserves server error', async () => {
  const f = fixture()
  const details = { candidates: ['space-a', 'space-b'] }
  f.fetch.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'space.ambiguous',
            debugMessage: 'Multiple spaces match this name',
            details,
          },
        }),
      ),
  )
  expect(await run(['node', 'list', '--space-name', 'same-name'], f.io)).toBe(6)
  expect(f.fetch).toHaveBeenCalledTimes(1)
  expect(f.out()).toBe('')
  expect(JSON.parse(f.err())).toEqual({
    error: {
      code: 'space.ambiguous',
      retryable: false,
      candidates: ['space-a', 'space-b'],
      message: 'Multiple spaces match this name',
      details: { ...details, space: { kind: 'spaceName', name: 'same-name' } },
      hint: 'Run "opencove space list" to find available targets.',
    },
  })
})

it('validates parsed command arguments once before connection discovery', async () => {
  const f = fixture()
  f.io.env = { OPENCOVE_PROJECT_ID: 'untrusted-project' }
  f.io.profileCandidates = vi.fn(() => ['/isolated/profile'])
  const validateBeforeConnect = vi.fn(() => {
    throw new CliError('cli.usage', 2, 'Choose --project before connecting.')
  })
  commands.push({
    path: ['preflight-fixture'],
    summary: 'Validate command arguments',
    connect: true,
    options: { count: { type: 'number', description: 'Count' } },
    validateBeforeConnect,
  })
  try {
    expect(await run(['preflight-fixture', '--count', '2'], f.io)).toBe(2)
    expect(validateBeforeConnect).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ options: { count: 2 }, positionals: [] }),
      f.io.env,
    )
    expect(JSON.parse(f.err()).error).toMatchObject({
      code: 'cli.usage',
      message: 'Choose --project before connecting.',
    })
    expect(f.io.profileCandidates).not.toHaveBeenCalled()
    expect(f.io.readTextFile).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.out()).toBe('')
  } finally {
    commands.pop()
  }
})

it.each([['--help'], ['--unknown']])(
  'skips command preflight for help or invalid arguments: %j',
  async (...flags) => {
    const f = fixture()
    f.io.env = {}
    const validateBeforeConnect = vi.fn(() => {
      throw new Error('Preflight must not run')
    })
    commands.push({
      path: ['preflight-fixture'],
      summary: 'Validate command arguments',
      connect: true,
      validateBeforeConnect,
    })
    try {
      expect(await run(['preflight-fixture', ...flags], f.io)).toBe(flags[0] === '--help' ? 0 : 2)
      expect(validateBeforeConnect).not.toHaveBeenCalled()
      expect(f.fetch).not.toHaveBeenCalled()
      expect(f.io.readTextFile).not.toHaveBeenCalled()
    } finally {
      commands.pop()
    }
  },
)

it('runs a successful command preflight once before invoking its operation', async () => {
  const f = fixture()
  const order: string[] = []
  const validateBeforeConnect = vi.fn(() => {
    order.push('validate')
  })
  f.fetch.mockImplementation(async () => {
    order.push('invoke')
    return new Response(JSON.stringify({ ok: true, value: { pong: true } }))
  })
  commands.push({
    path: ['preflight-fixture'],
    summary: 'Validate command arguments',
    connect: true,
    operation: 'system.ping',
    buildInput: () => null,
    validateBeforeConnect,
  })
  try {
    expect(await run(['preflight-fixture'], f.io)).toBe(0)
    expect(validateBeforeConnect).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['validate', 'invoke'])
    expect(f.out()).toBe('{"pong":true}\n')
  } finally {
    commands.pop()
  }
})
