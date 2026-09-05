// @vitest-environment node
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeHookChannel } from '../../src/app/main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../../src/app/main/controlSurface/agentHook/codexHookChannel'
import { AgentLaunchArtifactScope } from '../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import { ClaudeCodeAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'
import { CodexAgentProviderContribution } from '../../src/contexts/agent/infrastructure/providers/codex/CodexAgentProviderContribution'
import { TerminalProfileResolver } from '../../src/platform/terminal/TerminalProfileResolver'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function prepare(provider: 'codex' | 'claude', notify = false) {
  const channel = provider === 'codex' ? createCodexHookChannel({}) : createClaudeHookChannel({})
  cleanups.push(() => channel.dispose())
  const events: string[] = []
  channel.onState(event => events.push(event.state))
  const artifacts = new AgentLaunchArtifactScope()
  cleanups.push(() => artifacts.dispose())
  let runtimeExecutable = process.execPath
  if (process.platform !== 'win32') {
    const root = await mkdtemp(join(tmpdir(), "OpenCove hook ' 路径 $test "))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    runtimeExecutable = join(root, 'runtime')
    // Model Electron's mode switch without opening a GUI on a red run.
    await writeFile(
      runtimeExecutable,
      [
        '#!/bin/sh',
        '[ "$ELECTRON_RUN_AS_NODE" = 1 ] || { echo GUI_START_ATTEMPT >&2; exit 90; }',
        `exec '${process.execPath.replaceAll("'", `'"'"'`)}' "$@"`,
      ].join('\n'),
    )
    await chmod(runtimeExecutable, 0o700)
  }
  const contribution =
    provider === 'codex'
      ? new CodexAgentProviderContribution({
          channel,
          runtimeExecutable,
          hookTrustResolver: async () => (notify ? null : 'hooks.state={}'),
        })
      : new ClaudeCodeAgentProviderContribution({ channel, runtimeExecutable })
  const plan = await contribution.launcher.createLaunchPlan({
    artifacts,
    mode: 'new',
    prompt: '',
    model: null,
    resumeSessionId: null,
    agentFullAccess: false,
    workspaceDirectory: process.cwd(),
  })
  plan.onStarted?.('test-pty')
  const resolved = await new TerminalProfileResolver().resolveCommandSpawn({
    command: 'unused',
    args: [],
    cwd: process.cwd(),
    env: { ...process.env, ...plan.env },
    useProfile: false,
  })
  expect(resolved.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  let command: string
  let args: string[]
  if (provider === 'claude') {
    const settings = JSON.parse(
      await readFile(plan.args[plan.args.indexOf('--settings') + 1]!, 'utf8'),
    )
    const handler = settings.hooks.UserPromptSubmit[0].hooks[0]
    command = handler.command
    args = handler.args
  } else if (notify) {
    const configuration = plan.args.find(arg => arg.startsWith('notify='))!
    const vector = parseTomlArray(configuration.slice('notify='.length))
    command = vector[0]!
    args = vector.slice(1)
  } else {
    const configuration = plan.args.find(arg => arg.startsWith('hooks.UserPromptSubmit='))!
    const key = process.platform === 'win32' ? 'commandWindows' : 'command'
    const match = configuration.match(new RegExp(`${key}=("(?:[^"\\\\]|\\\\.)*"|'[^']*')`))!
    const shellCommand = parseTomlString(match[1]!)
    command = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
    args =
      process.platform === 'win32' ? ['-NoProfile', '-Command', shellCommand] : ['-c', shellCommand]
  }
  return { command, args, env: resolved.env, events, plan }
}

function parseTomlString(value: string): string {
  return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1)
}

function parseTomlArray(value: string): string[] {
  return [...value.matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'/gu)].map(match => parseTomlString(match[0]))
}

function run(
  invocation: { command: string; args: string[]; env: NodeJS.ProcessEnv },
  input: string | null,
) {
  return new Promise<{ code: number | null; stderr: string; stdout: string; timedOut: boolean }>(
    (resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        env: invocation.env,
        windowsHide: true,
      })
      let stderr = ''
      let stdout = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, 4500)
      child.stderr.on('data', chunk => (stderr += chunk))
      child.stdout.on('data', chunk => (stdout += chunk))
      child.stdin.on('error', () => undefined)
      child.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', code => {
        clearTimeout(timer)
        resolve({ code, stderr, stdout, timedOut })
      })
      if (input !== null) {
        child.stdin.end(input)
      }
    },
  )
}

describe('provider Hook relay through sanitized launch environments', () => {
  it.each(['codex', 'claude'] as const)(
    '%s reports through the actual generated command without launching a GUI',
    async provider => {
      const invocation = await prepare(provider)
      const payload = JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'relay-test',
        transcript_path: '/tmp/transcript',
        cwd: process.cwd(),
      })
      const results = await Promise.all(Array.from({ length: 3 }, () => run(invocation, payload)))
      for (const result of results) {
        expect(result).toEqual({
          code: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
        })
      }
      expect(invocation.events).toEqual(['working', 'working', 'working'])
      expect(invocation.plan.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    },
  )

  it('legacy notify preserves its JSON argument and reports completion', async () => {
    const invocation = await prepare('codex', true)
    invocation.args.push(
      JSON.stringify({
        type: 'agent-turn-complete',
        'thread-id': 'notify-test',
        text: '"quotes" $HOME `code` 中文',
      }),
    )
    expect(await run(invocation, null)).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    expect(invocation.events).toEqual(['standby'])
  })

  it.each(['codex', 'claude'] as const)(
    '%s exits quietly when stdin never closes',
    async provider => {
      const invocation = await prepare(provider)
      expect(await run(invocation, null)).toEqual({
        code: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      })
      expect(invocation.events).toEqual([])
    },
  )

  it('exits quietly when the receiver accepts a connection but never responds', async () => {
    const server = createServer(() => undefined)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(
      () =>
        new Promise<void>(resolve => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    )
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing receiver port')
    }
    const invocation = await prepare('codex')
    invocation.env.OPENCOVE_CODEX_HOOK_ENDPOINT = `http://127.0.0.1:${address.port}/hooks/codex`
    expect(await run(invocation, '{}')).toEqual({
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
  })
})
