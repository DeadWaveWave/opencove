import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const helperPath = resolve(__dirname, '../../../src/app/cli/hooks/claude-status.mjs')

function runHelper(options: { env?: NodeJS.ProcessEnv; input: unknown }): Promise<number | null> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [helperPath], {
      env: options.env ?? {},
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.once('error', reject)
    child.once('exit', resolveExit)
    child.stdin.end(JSON.stringify(options.input))
  })
}

describe('managed Claude hook helper', () => {
  it('exits silently without side effects outside an OpenCove agent spawn', async () => {
    await expect(
      runHelper({
        env: {},
        input: { hook_event_name: 'PermissionRequest', session_id: 'claude-1' },
      }),
    ).resolves.toBe(0)
  })

  it('posts a normalized authenticated envelope when activated', async () => {
    let received: { headers: Record<string, string | string[] | undefined>; body: unknown } | null =
      null
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        received = {
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }
        response.statusCode = 204
        response.end()
      })
    })
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing test listener address.')
    }

    try {
      await expect(
        runHelper({
          env: {
            OPENCOVE_CLAUDE_HOOK_ENDPOINT: `http://127.0.0.1:${address.port}/hooks/claude`,
            OPENCOVE_CLAUDE_HOOK_TOKEN: 'secret-token',
          },
          input: {
            hook_event_name: 'PermissionRequest',
            session_id: 'claude-1',
            tool_name: 'Bash',
            tool_use_id: 'tool-1',
            tool_input: { command: 'pnpm test' },
          },
        }),
      ).resolves.toBe(0)
      expect(received).toEqual({
        headers: expect.objectContaining({ 'x-opencove-hook-token': 'secret-token' }),
        body: {
          version: 1,
          state: 'waiting',
          hookEventName: 'PermissionRequest',
          claudeSessionId: 'claude-1',
          tool: { name: 'Bash', useId: 'tool-1', input: { command: 'pnpm test' } },
        },
      })
    } finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    }
  })
})
