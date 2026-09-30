// @vitest-environment node
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '../../../src/platform/process/runCommand'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/app/cli/constants.mjs'
import { resolvePluginCommandTimeout } from '../../../src/app/cli/commands/plugins.mjs'

let root: string
const cli = resolve('src/app/cli/opencove.mjs')

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'opencove-plugin-command-')))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function runPlugin(args: string[]) {
  return runCommand(process.execPath, [cli, 'plugin', ...args], root, {
    timeoutMs: 3_000,
    env: { ...process.env, OPENCOVE_USER_DATA_DIR: root },
  })
}

describe('offline plugin commands', () => {
  it('allows install and reload activation time without changing other command defaults or explicit timeouts', () => {
    expect(resolvePluginCommandTimeout({ id: 'plugin.install' }, null)).toBe(60_000)
    expect(resolvePluginCommandTimeout({ id: 'plugin.reload' }, null)).toBe(600_000)
    for (const id of ['plugin.list', 'plugin.details', 'plugin.setEnabled', 'plugin.uninstall']) {
      expect(resolvePluginCommandTimeout({ id }, null)).toBeNull()
    }
    expect(resolvePluginCommandTimeout({ id: 'plugin.install' }, 75_000)).toBe(75_000)
    expect(resolvePluginCommandTimeout({ id: 'plugin.reload' }, 5_000)).toBe(5_000)
  })
  it('prints a readable source guide without creating a profile or requiring endpoint credentials', async () => {
    const result = await runPlugin(['guide', '--pretty', '--endpoint', 'invalid'])
    expect(result.exitCode, result.stderr).toBe(0)
    const guide = JSON.parse(result.stdout)
    expect(guide.directory).toBe(resolve('docs/plugins'))
    expect(await readFile(guide.readme, 'utf8')).not.toBe('')
    expect(await readdir(root)).toEqual([])
  })

  it.each(['remove', 'dev', 'invoke', 'unknown', ''])(
    'rejects unsupported plugin command "%s" before connection discovery',
    async subcommand => {
      const result = await runPlugin([...(subcommand ? [subcommand] : []), '--endpoint', 'invalid'])
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('unsupported plugin command')
      expect(result.stderr).toContain('opencove plugin guide')
      expect(result.stderr).not.toContain('control surface')
      expect(result.stderr).not.toContain('--token')
      expect(result.stdout).toBe('')
      expect(await readdir(root)).toEqual([])
    },
  )

  it.each([
    ['install'],
    ['enable'],
    ['reload'],
    ['uninstall'],
    ['disable'],
    ['details'],
    ['guide', 'extra'],
    ['list', 'extra'],
    ['install', '--directory', '/tmp/plugin'],
  ])('rejects invalid plugin arguments %j before connection discovery', async (...args) => {
    const result = await runPlugin([...args, '--endpoint', 'invalid'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('usage: opencove plugin')
    expect(result.stderr).not.toContain('--token')
    expect(await readdir(root)).toEqual([])
  })

  it.each(['failed', 'conflict'])(
    'returns nonzero for distribution %s while retaining candidate JSON',
    async status => {
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          chunks.push(chunk)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString())
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            ok: true,
            value:
              body.id === 'system.capabilities'
                ? { protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION }
                : {
                    status,
                    candidateId: 'candidate',
                    candidateDirectory: '/preserved/source',
                    error: 'Needs attention',
                  },
          }),
        )
      })
      await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
      try {
        const address = server.address()
        if (!address || typeof address === 'string') {
          throw new Error('Missing fixture address')
        }
        const result = await runPlugin([
          'update',
          'fixture',
          '--endpoint',
          `http://127.0.0.1:${address.port}`,
          '--token',
          'fixture',
        ])
        expect(result.exitCode).toBe(1)
        expect(JSON.parse(result.stdout)).toMatchObject({
          ok: true,
          value: { status, candidateId: 'candidate', candidateDirectory: '/preserved/source' },
        })
      } finally {
        server.closeAllConnections()
        await new Promise<void>(done => server.close(() => done()))
      }
    },
  )

  it('keeps plugin list routed through the control surface', async () => {
    const requests: string[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push(body.id)
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          ok: true,
          value:
            body.id === 'system.capabilities'
              ? { protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION }
              : [{ id: 'sample-plugin' }],
        }),
      )
    })
    await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Missing test server address')
      }
      const result = await runPlugin([
        'list',
        '--endpoint',
        `http://127.0.0.1:${address.port}`,
        '--token',
        'fixture',
      ])
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, value: [{ id: 'sample-plugin' }] })
      expect(requests).toEqual(['system.capabilities', 'plugin.list'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolvePromise, reject) =>
        server.close(error => (error ? reject(error) : resolvePromise())),
      )
    }
  })

  it.each([
    { args: ['install', './my plugin'], kind: 'command', id: 'plugin.install' },
    { args: ['details', 'my-plugin'], kind: 'query', id: 'plugin.details' },
    { args: ['reload', 'my-plugin'], kind: 'command', id: 'plugin.reload' },
    { args: ['uninstall', 'my-plugin'], kind: 'command', id: 'plugin.uninstall' },
    { args: ['enable', 'my-plugin'], kind: 'command', id: 'plugin.setEnabled', enabled: true },
    { args: ['disable', 'my-plugin'], kind: 'command', id: 'plugin.setEnabled', enabled: false },
  ])('routes $args through the control surface', async fixture => {
    const requests: unknown[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push(body)
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          ok: true,
          value:
            body.id === 'system.capabilities'
              ? { protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION }
              : { plugin: { id: 'my-plugin' } },
        }),
      )
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Missing test server address')
      }
      const result = await runPlugin([
        ...fixture.args,
        '--endpoint',
        `http://127.0.0.1:${address.port}`,
        '--token',
        'fixture',
      ])
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        value: { plugin: { id: 'my-plugin' } },
      })
      expect(requests).toEqual([
        { kind: 'query', id: 'system.capabilities', payload: null },
        {
          kind: fixture.kind,
          id: fixture.id,
          payload:
            fixture.id === 'plugin.install'
              ? { directory: join(root, 'my plugin') }
              : {
                  pluginId: 'my-plugin',
                  ...('enabled' in fixture ? { enabled: fixture.enabled } : {}),
                },
        },
      ])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((done, reject) =>
        server.close(error => (error ? reject(error) : done())),
      )
    }
  })
})
