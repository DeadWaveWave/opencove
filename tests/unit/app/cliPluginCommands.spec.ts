// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCommand } from '../../../src/platform/process/runCommand'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/app/cli/constants.mjs'

let root: string
const cli = resolve('src/app/cli/opencove.mjs')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'opencove-plugin-command-'))
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
  it('prints a readable source guide without creating a profile or requiring endpoint credentials', async () => {
    const result = await runPlugin(['guide', '--pretty', '--endpoint', 'invalid'])
    expect(result.exitCode, result.stderr).toBe(0)
    const guide = JSON.parse(result.stdout)
    expect(guide.directory).toBe(resolve('docs/plugins'))
    expect(await readFile(guide.readme, 'utf8')).not.toBe('')
    expect(await readdir(root)).toEqual([])
  })

  it.each(['install', 'enable', 'remove', 'unknown', ''])(
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
              : [{ id: 'git-board' }],
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
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, value: [{ id: 'git-board' }] })
      expect(requests).toEqual(['system.capabilities', 'plugin.list'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolvePromise, reject) =>
        server.close(error => (error ? reject(error) : resolvePromise())),
      )
    }
  })
})
