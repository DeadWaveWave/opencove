// @vitest-environment node
import { spawn } from 'node-pty'
import { expect, it } from 'vitest'
import { buildAgentLaunchCommand } from '../../../src/contexts/agent/infrastructure/cli/AgentCommandFactory'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { parseClaude } from '../../fixtures/provider-argv/claudeParser.mjs'
import { preparePtySpawnArguments } from '../../../src/platform/process/spawnArguments'

const native = it.runIf(process.platform !== 'win32')
const resolver = new TerminalProfileResolver({ platform: process.platform })
const input = {
  provider: 'claude-code' as const,
  mode: 'new' as const,
  resumeSessionId: '11111111-1111-4111-8111-111111111111',
  model: null,
  prompt: 'Explain this project',
}
async function receive(args: string[], validate = true) {
  const nativeArgs = ['%s\\000', ...args]
  const child = spawn(
    '/usr/bin/printf',
    validate ? preparePtySpawnArguments('/usr/bin/printf', nativeArgs, '/tmp') : nativeArgs,
    {
      cwd: '/tmp',
      env: { PATH: '/usr/bin:/bin' },
      cols: 200,
      rows: 30,
    },
  )
  let text = ''
  let exited = false
  const data = child.onData(chunk => {
    text += chunk
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native receiver timed out')), 5000)
      child.onExit(({ exitCode }) => {
        exited = true
        clearTimeout(timer)
        if (exitCode !== 0) {
          reject(new Error(`Receiver exit ${exitCode}`))
        } else {
          resolve()
        }
      })
    })
    return text.split('\0').slice(0, -1)
  } finally {
    data.dispose()
    if (!exited) {
      child.kill()
    }
  }
}
native(
  'negative control: real node-pty truncates NUL into a Claude command despite --',
  async () => {
    const plan = buildAgentLaunchCommand(input)
    const argv = await receive([...plan.args.slice(0, -1), 'plugins\0 explain this project'], false)
    expect(argv.at(-1)).toBe('plugins')
    expect(parseClaude(argv)).toMatchObject({ command: 'plugins' })
  },
)
native.each(['$(printf update)', '`printf update`', 'Explain "quotes" \\ 中文 😀'])(
  'real factory, resolver and node-pty preserve %j at the receiver',
  async prompt => {
    const plan = buildAgentLaunchCommand({ ...input, prompt })
    const resolved = await resolver.resolveCommandSpawn({
      cwd: '/tmp',
      command: '/usr/bin/printf',
      args: plan.args,
    })
    const argv = await receive(resolved.args)
    expect(argv).toEqual(plan.args)
    expect(parseClaude(argv)).toMatchObject({ prompt, command: undefined })
  },
)
native(
  'rejects NUL in the real factory and raw resolver before reaching the native receiver',
  async () => {
    expect(() =>
      buildAgentLaunchCommand({ ...input, prompt: 'plugins\0 explain this project' }),
    ).toThrow()
    await expect(
      resolver.resolveCommandSpawn({
        cwd: '/tmp',
        command: '/usr/bin/printf',
        args: ['plugins\0 explain this project'],
      }),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
    await expect(receive(['--', 'plugins\0 explain this project'])).rejects.toMatchObject({
      code: 'common.invalid_input',
      details: { reason: 'invalid_spawn_arguments' },
    })
  },
)
