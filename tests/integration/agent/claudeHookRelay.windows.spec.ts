import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createClaudeHookChannel } from '../../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

it.skipIf(process.platform !== 'win32')(
  'forwards Windows hook stdin without a BOM through Electron',
  async () => {
    const channel = createClaudeHookChannel({})
    const artifacts = new AgentLaunchArtifactScope()
    const events: TerminalSessionStateEvent[] = []
    channel.onState(event => events.push(event))
    try {
      const provider = new ClaudeCodeAgentProviderContribution({
        channel,
        runtimeExecutable: resolve('node_modules/electron/dist/electron.exe'),
        runtimePlatform: 'win32',
      })
      const plan = await provider.hookInjection.prepareHookInjection({
        artifacts,
        workspaceDirectory: process.cwd(),
      })
      plan.onStarted?.('relay-test')
      const settings = JSON.parse(await readFile(plan.args[1], 'utf8'))
      const handler = settings.hooks.UserPromptSubmit[0].hooks[0]
      const child = spawn(handler.command, handler.args, {
        env: { ...process.env, ...plan.env },
        windowsHide: true,
      })
      const timeout = setTimeout(() => child.kill(), 5000)
      let stderr = ''
      child.stderr.on('data', data => {
        stderr += data
      })
      child.stdout.resume()
      child.stdin.on('error', () => undefined)
      try {
        const closed = new Promise<number | null>((resolveExit, reject) => {
          child.once('close', resolveExit)
          child.once('error', reject)
        })
        child.stdin.end(
          JSON.stringify({
            session_id: 'test',
            transcript_path: '/tmp/fixture-transcript',
            hook_event_name: 'UserPromptSubmit',
            cwd: process.cwd(),
          }),
        )
        expect(await closed).toBe(0)
        expect(stderr).toBe('')
        expect(events).toMatchObject([
          { sessionId: 'relay-test', state: 'working', source: 'claude_hook' },
        ])
      } finally {
        clearTimeout(timeout)
        if (child.exitCode === null) {
          child.kill()
        }
      }
    } finally {
      await artifacts.dispose()
      await channel.dispose()
    }
  },
  15_000,
)
