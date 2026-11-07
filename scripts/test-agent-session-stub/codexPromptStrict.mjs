import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { runPromptStrictScenario } from './promptStrict.mjs'

/** Execute the actual lifecycle command injected by the contribution, with raw Codex stdin. */
export async function runCodexPromptStrictScenario(cwd, providerArgs) {
  return runPromptStrictScenario(cwd, providerArgs, async () => {
    const commands = new Map()
    for (let index = 0; index < providerArgs.length - 1; index++) {
      if (providerArgs[index] !== '--config') {
        continue
      }
      const config = providerArgs[++index]
      const event = config.match(/^hooks\.([A-Za-z]+)=/u)?.[1]
      const command = config.match(/,command=("(?:\\.|[^"\\])*")/u)?.[1]
      if (event && command) {
        commands.set(event, JSON.parse(command))
      }
    }
    if (!['UserPromptSubmit', 'Stop', 'PermissionRequest'].every(event => commands.has(event))) {
      throw new Error('Strict prompt fixture requires generated Codex lifecycle hooks')
    }
    return async event => {
      const child = spawn(commands.get(event), {
        shell: true,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.stdout.resume()
      child.stderr.pipe(process.stderr)
      child.stdin.on('error', () => {})
      const closed = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code =>
          code === 0 ? resolve() : reject(new Error(`Hook relay failed ${code}`)),
        )
      })
      child.stdin.end(
        JSON.stringify({
          session_id: 'strict-codex',
          transcript_path: join(cwd, '.codex-prompt-strict.jsonl'),
          cwd,
          hook_event_name: event,
          model: 'fixture-model',
          permission_mode: 'default',
          turn_id: 'fixture-turn',
          ...(event === 'PermissionRequest'
            ? {
                tool_name: 'Bash',
                tool_use_id: 'fixture-permission',
                tool_input: { command: 'true' },
              }
            : {}),
        }),
      )
      await closed
    }
  })
}
