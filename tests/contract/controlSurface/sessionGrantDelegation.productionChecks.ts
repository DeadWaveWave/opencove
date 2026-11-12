/* eslint-disable no-await-in-loop -- Each CLI command observes the preceding committed mutation. */
import { expect, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'

/** The CLI and HTTP runtime are real; only the socket and physical PTY are test ports. */
export async function checkProductionGrantDelegation(options: {
  env: Record<string, string | undefined>
  invoke(
    id: string,
    payload: unknown,
    token?: string,
    kind?: string,
  ): Promise<{
    status: number
    result: unknown
  }>
  spawned(): Parameters<ControlSurfacePtyRuntime['spawnSession']>[0][]
}) {
  const cli = async (...args: string[]) => {
    let stdout = '',
      stderr = ''
    const io: CliIo = {
      env: options.env,
      now: Date.now,
      stdout: { write: text => (stdout += text) },
      stderr: { write: text => (stderr += text) },
      readStdinText: vi.fn(),
      readTextFile: vi.fn(),
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body))
        const response = await options.invoke(
          request.id,
          request.payload,
          new Headers(init?.headers).get('authorization')!.slice('Bearer '.length),
          request.kind,
        )
        return new Response(JSON.stringify(response.result), { status: response.status })
      },
    }
    expect(await run(args, io), `${args.join(' ')}\n${stderr}`).toBe(0)
    return JSON.parse(stdout)
  }
  for (const [kind, flags] of [
    ['note', ['--text', 'Brief']],
    ['task', ['--requirement', 'Verify grants']],
    ['website', ['--url', 'https://example.com']],
  ] as const) {
    const { node } = await cli('node', 'create', kind, ...flags)
    await cli('node', 'update', kind, '--node', node.id, ...flags)
    await cli('canvas', 'focus', 'node', '--node', node.id)
    await cli('node', 'delete', '--node', node.id)
  }
  const before = options.spawned().length
  const command = `node -e "setInterval(()=>console.log('VIEWER_'+'STREAM_READY'),100)"`
  const { node } = await cli('node', 'create', 'terminal', '--command', command)
  expect(options.spawned()).toHaveLength(before + 1)
  expect(options.spawned().at(-1)).toMatchObject({
    command: expect.any(String),
    args: expect.arrayContaining([command]),
    env: { OPENCOVE_NODE_ID: node.id },
  })
  expect(node).toMatchObject({
    kind: 'terminal',
    spawnedBy: options.env.OPENCOVE_NODE_ID,
    lineageDepth: 2,
  })
  await cli('node', 'delete', '--node', node.id)
}
