// @vitest-environment node
import { spawn } from 'node:child_process'
import { expect, it } from 'vitest'
import { createClaudeHookChannel } from '../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../../src/app/main/controlSurface/agentHook/codexHookChannel'
import { createAgentHookRelay } from '../../src/contexts/agent/infrastructure/providers/shared/AgentHookRelay'
import { AgentLaunchArtifactScope } from '../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { residentContextV1 } from '../../src/shared/runtime/agentHook/residentContext'

it.each(['claude', 'codex'] as const)(
  '%s executable relay receives real channel context before and after commit',
  async provider => {
    const channel = (provider === 'claude' ? createClaudeHookChannel : createCodexHookChannel)({})
    channel.setResidentContextEnabled!(async () => true)
    const artifacts = new AgentLaunchArtifactScope()
    try {
      const reservation = await channel.reserveSpawn({ residentContext: 'canvas' })
      expect(reservation.usesHook).toBe(true)
      const relay = await createAgentHookRelay({
        provider,
        runtimeExecutable: process.execPath,
        runtimePlatform: process.platform,
        artifacts,
      })
      const invoke = async () =>
        await new Promise<{ code: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(relay.command, relay.args, {
              env: { ...process.env, ...reservation.env },
              stdio: ['pipe', 'pipe', 'pipe'],
            })
            let stdout = '',
              stderr = ''
            child.stdout.on('data', data => {
              stdout += data
            })
            child.stderr.on('data', data => {
              stderr += data
            })
            child.once('error', reject)
            child.once('close', code => resolve({ code, stdout, stderr }))
            child.stdin.end(
              JSON.stringify({
                hook_event_name: 'SessionStart',
                session_id: 'provider-session',
                cwd: '/tmp',
                transcript_path: '/tmp/nonexistent',
              }),
            )
          },
        )
      const expected = {
        code: 0,
        stdout:
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: residentContextV1,
            },
          }) + '\n',
        stderr: '',
      }
      expect(await invoke()).toEqual(expected)
      reservation.commit('pty')
      expect(await invoke()).toEqual(expected)
      channel.setResidentContextEnabled!(async () => false)
      expect(await invoke()).toEqual({ code: 0, stdout: '', stderr: '' })
    } finally {
      await channel.dispose()
      await artifacts.dispose()
    }
  },
)
