#!/usr/bin/env node

import { resolve } from 'node:path'
import { sleep } from './test-agent-session-stub/sleep.mjs'
import {
  runCodexCommentaryThenFinalScenario,
  runCodexClickRedrawAfterClickScenario,
  runCodexStandbyNoNewlineScenario,
  runCodexStandbyOnlyScenario,
  runJsonlStdinSubmitDelayedTurnScenario,
  runJsonlStdinSubmitDrivenTurnScenario,
} from './test-agent-session-stub/codex.mjs'
import { runStdinEchoScenario } from './test-agent-session-stub/stdinEcho.mjs'
import {
  runGeminiStdinSubmitThenReplyScenario,
  runGeminiUserThenGeminiScenario,
} from './test-agent-session-stub/gemini.mjs'
import { runOpenCodeIdleWithMessageScenario } from './test-agent-session-stub/opencode.mjs'
import {
  runRawAltScreenWheelEchoScenario,
  runRawBracketedPasteEchoScenario,
  runRawClickRedrawAfterClickScenario,
  runRawColorProbeScenario,
  runRawDsrReplyEchoScenario,
  runRawFocusRedrawAfterFocusScenario,
} from './test-agent-session-stub/raw.mjs'

function isLikelyScenarioArg(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false
  }

  return (
    value === 'stdin-echo' ||
    value.startsWith('raw-') ||
    value.startsWith('jsonl-stdin-submit-') ||
    value.startsWith('codex-') ||
    value.startsWith('gemini-') ||
    value.startsWith('opencode-')
  )
}

async function main() {
  const [
    provider = 'codex',
    rawCwd = process.cwd(),
    mode = 'new',
    model = 'default-model',
    rawResumeSessionId = '',
    rawScenario = '',
  ] = process.argv.slice(2)
  const cwd = resolve(rawCwd)
  const scenario =
    rawScenario.length > 0
      ? rawScenario
      : isLikelyScenarioArg(rawResumeSessionId)
        ? rawResumeSessionId
        : ''
  const resumeSessionId =
    rawScenario.length > 0 || !isLikelyScenarioArg(rawResumeSessionId) ? rawResumeSessionId : ''

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

  if (provider === 'codex' && scenario === 'codex-click-redraw-after-click') {
    await runCodexClickRedrawAfterClickScenario(cwd)
    return
  }

  if (
    (provider === 'codex' || provider === 'claude-code') &&
    scenario === 'jsonl-stdin-submit-delayed-turn'
  ) {
    await runJsonlStdinSubmitDelayedTurnScenario(provider, cwd)
    return
  }

  if (
    (provider === 'codex' || provider === 'claude-code') &&
    scenario === 'jsonl-stdin-submit-driven-turn'
  ) {
    await runJsonlStdinSubmitDrivenTurnScenario(
      provider,
      cwd,
      mode,
      resumeSessionId.length > 0 ? resumeSessionId : null,
    )
    return
  }

  if (scenario === 'stdin-echo') {
    await runStdinEchoScenario()
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

  if (scenario === 'raw-dsr-reply-echo') {
    await runRawDsrReplyEchoScenario()
    return
  }

  if (scenario === 'raw-color-probe') {
    await runRawColorProbeScenario()
    return
  }

  if (scenario === 'raw-focus-redraw-after-focus') {
    await runRawFocusRedrawAfterFocusScenario()
    return
  }

  if (scenario === 'raw-click-redraw-after-click') {
    await runRawClickRedrawAfterClickScenario()
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
