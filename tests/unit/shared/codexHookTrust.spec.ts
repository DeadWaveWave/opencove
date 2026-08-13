import { describe, expect, it } from 'vitest'
import { computeCodexHookTrustedHash } from '../../../src/shared/runtime/codexHookTrust'

describe('Codex hook trust identity', () => {
  it('matches the canonical command hook hash contract', () => {
    const goldenCommand =
      "if [ -f '/Users/shihaojie/.orca/agent-hooks/codex-hook.sh' ] && [ -r '/Users/shihaojie/.orca/agent-hooks/codex-hook.sh' ] && [ -x '/Users/shihaojie/.orca/agent-hooks/codex-hook.sh' ]; then /bin/sh '/Users/shihaojie/.orca/agent-hooks/codex-hook.sh'; else { command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :; fi"
    expect(
      computeCodexHookTrustedHash({
        eventName: 'PreToolUse',
        command: goldenCommand,
        timeoutSeconds: 10,
      }),
    ).toBe('sha256:ef4cab48335903c5e10948adb3c271564dcdfe821f440f3ec665fa9a567e77d7')
  })

  it('drops matchers for prompt and stop events', () => {
    const base = { command: 'printf managed', timeoutSeconds: 10 }
    expect(
      computeCodexHookTrustedHash({ ...base, eventName: 'UserPromptSubmit', matcher: 'ignored' }),
    ).toBe(computeCodexHookTrustedHash({ ...base, eventName: 'UserPromptSubmit' }))
    expect(computeCodexHookTrustedHash({ ...base, eventName: 'Stop', matcher: 'ignored' })).toBe(
      computeCodexHookTrustedHash({ ...base, eventName: 'Stop' }),
    )
    expect(
      computeCodexHookTrustedHash({ ...base, eventName: 'PreToolUse', matcher: 'kept' }),
    ).not.toBe(computeCodexHookTrustedHash({ ...base, eventName: 'PreToolUse' }))
  })
})
