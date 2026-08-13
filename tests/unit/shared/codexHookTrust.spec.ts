import { describe, expect, it } from 'vitest'
import { buildManagedCodexHookCommand } from '../../../src/shared/runtime/codexHookRuntime'
import { computeCodexHookTrustedHash } from '../../../src/shared/runtime/codexHookTrust'

describe('Codex hook trust identity', () => {
  it('matches the canonical command hook hash contract', () => {
    const installedCommand = buildManagedCodexHookCommand(
      '/Users/tester/.opencove/agent-hooks/codex-hook.sh',
    )
    expect(
      computeCodexHookTrustedHash({
        eventName: 'PreToolUse',
        command: installedCommand,
        timeoutSeconds: 10,
      }),
    ).toBe('sha256:948aff68c30919675ecdd86b30caff1e523b6e4e0206b944e0bbadedfb12b4b5')
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
