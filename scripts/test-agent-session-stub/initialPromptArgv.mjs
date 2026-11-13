import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseClaude } from '../../tests/fixtures/provider-argv/claudeParser.mjs'
import { parseArgs } from '../../tests/fixtures/provider-argv/pi.mjs'
import { parsePackageCommand } from '../../tests/fixtures/provider-argv/piPackage.mjs'
import {
  parseCodex,
  parseStringOptions,
} from '../../tests/fixtures/provider-argv/stringOptions.mjs'
import { sleep } from './sleep.mjs'

/** Receives the actual argv from the production planner, never provider credentials or IO. */
export async function runInitialPromptArgvScenario(cwd, provider, args) {
  let parsed
  if (provider === 'claude-code') {
    parsed = parseClaude(args)
  } else if (provider === 'codex') {
    parsed = parseCodex(args)
  } else if (provider === 'pi') {
    const result = parseArgs(args)
    parsed = {
      prompt: result.messages[0],
      command: parsePackageCommand(args)?.command,
      files: result.fileArgs,
      diagnostics: result.diagnostics,
      model: result.model,
    }
  } else {
    parsed = parseStringOptions(provider, args)
    parsed.prompt = parsed.values[provider === 'gemini' ? '--prompt-interactive' : '--prompt']
  }
  await appendFile(
    join(cwd, 'initial-prompt-argv.jsonl'),
    JSON.stringify({ provider, args, ...parsed }) + '\n',
  )
  process.stdout.write('[opencove-test-agent] argv recorded\n')
  await sleep(120_000)
}
