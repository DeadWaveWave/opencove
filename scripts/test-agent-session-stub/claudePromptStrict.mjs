import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runPromptStrictScenario } from './promptStrict.mjs'

export async function runClaudePromptStrictScenario(cwd, providerArgs) {
  return runPromptStrictScenario(cwd, providerArgs, async () => {
    const settingsPath = providerArgs[providerArgs.indexOf('--settings') + 1]
    if (!settingsPath) {
      throw new Error('Strict prompt fixture requires generated Claude settings')
    }
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    const sessionIndex = providerArgs.includes('--session-id')
      ? providerArgs.indexOf('--session-id')
      : providerArgs.indexOf('--resume')
    const providerSessionId = sessionIndex >= 0 ? providerArgs[sessionIndex + 1] : 'strict-claude'
    return async event => {
      const handler = settings.hooks[event][0].hooks[0]
      const child = spawn(handler.command, handler.args, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stdout.resume()
      child.stderr.pipe(process.stderr)
      child.stdin.on('error', () => {})
      child.stdin.end(
        JSON.stringify({
          session_id: providerSessionId,
          // Real Claude always sends it; the receiver rejects inputs without it.
          transcript_path: join(cwd, '.claude-prompt-strict.jsonl'),
          cwd,
          hook_event_name: event,
          tool_name: 'Bash',
        }),
      )
      await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', code =>
          code === 0 ? resolve() : reject(new Error(`Hook relay failed ${code}`)),
        )
      })
    }
  })
}
