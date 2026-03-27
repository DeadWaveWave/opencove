#!/usr/bin/env node

import { resolve } from 'node:path'
import { sleep } from './test-agent-session-stub/sleep.mjs'
import {
  runCodexCommentaryThenFinalScenario,
  runCodexStandbyNoNewlineScenario,
  runCodexStandbyOnlyScenario,
  runJsonlStdinSubmitDelayedTurnScenario,
} from './test-agent-session-stub/codex.mjs'
import {
  runGeminiStdinSubmitThenReplyScenario,
  runGeminiUserThenGeminiScenario,
} from './test-agent-session-stub/gemini.mjs'
import { runOpenCodeIdleWithMessageScenario } from './test-agent-session-stub/opencode.mjs'
import {
  runRawAltScreenWheelEchoScenario,
  runRawBracketedPasteEchoScenario,
} from './test-agent-session-stub/raw.mjs'

async function main() {
  const [
    provider = 'codex',
    rawCwd = process.cwd(),
    mode = 'new',
    model = 'default-model',
    scenario = '',
  ] = process.argv.slice(2)
  const cwd = resolve(rawCwd)

  process.stdout.write(`[opencove-test-agent] ${provider} ${mode} ${model}\n`)

  if (provider === 'codex' && scenario === 'codex-standby-no-newline') {
    await runCodexStandbyNoNewlineScenario(cwd)
    return
  }

  if (provider === 'codex' && scenario === 'codex-standby-only') {
    await runCodexStandbyOnlyScenario(cwd)
    return
  }

  if (provider === 'codex' && scenario === 'codex-commentary-then-final') {
    await runCodexCommentaryThenFinalScenario(cwd)
    return
  }

  if (
    (provider === 'codex' || provider === 'claude-code') &&
    scenario === 'jsonl-stdin-submit-delayed-turn'
  ) {
    await runJsonlStdinSubmitDelayedTurnScenario(provider, cwd)
    return
  }

  if (scenario === 'raw-bracketed-paste-echo') {
    await runRawBracketedPasteEchoScenario()
    return
  }

  if (scenario === 'raw-alt-screen-wheel-echo') {
    await runRawAltScreenWheelEchoScenario()
    return
  }

  if (provider === 'gemini' && scenario === 'gemini-user-then-gemini') {
    await runGeminiUserThenGeminiScenario(cwd)
    return
  }

  if (provider === 'gemini' && scenario === 'gemini-stdin-submit-then-reply') {
    await runGeminiStdinSubmitThenReplyScenario(cwd)
    return
  }

  if (provider === 'opencode' && scenario === 'opencode-idle-with-message') {
    await runOpenCodeIdleWithMessageScenario(cwd)
    return
  }

  await sleep(120_000)
}

await main()
