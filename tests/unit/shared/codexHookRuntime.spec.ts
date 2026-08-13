import { describe, expect, it } from 'vitest'
import {
  buildCodexHookPtyEnv,
  buildManagedCodexHookCommand,
  buildManagedCodexHookScript,
  serializeAgentHookEndpoint,
} from '../../../src/shared/runtime/codexHookRuntime'

describe('Codex hook runtime artifacts', () => {
  it('builds the POSIX guard and drains stdin when the script is unavailable', () => {
    expect(buildManagedCodexHookCommand("/tmp/Open Cove's/codex-hook.sh")).toBe(
      "if [ -f '/tmp/Open Cove'\\''s/codex-hook.sh' ] && [ -r '/tmp/Open Cove'\\''s/codex-hook.sh' ] && [ -x '/tmp/Open Cove'\\''s/codex-hook.sh' ]; then /bin/sh '/tmp/Open Cove'\\''s/codex-hook.sh'; else { command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :; fi",
    )
  })

  it('builds a fail-open shell transport with endpoint sourcing and form POST', () => {
    const script = buildManagedCodexHookScript()
    expect(script).toContain('. "$endpoint_path" 2>/dev/null || :')
    expect(script).toContain('load_hook_endpoint "$OPENCOVE_AGENT_HOOK_ENDPOINT"')
    expect(script).toContain('http://127.0.0.1:${OPENCOVE_AGENT_HOOK_PORT}/hook/codex')
    expect(script).toContain('-H "Content-Type: application/x-www-form-urlencoded"')
    expect(script).toContain('--data-urlencode "paneKey=${OPENCOVE_PANE_KEY}"')
    expect(script).toContain('--data-urlencode "payload@-"')
    expect(script.endsWith('exit 0\n')).toBe(true)
  })

  it('serializes only shell-safe endpoint coordinates', () => {
    expect(
      serializeAgentHookEndpoint({
        port: 63084,
        token: 'abc-123_def',
        environment: 'production',
        version: '1',
      }),
    ).toBe(
      'OPENCOVE_AGENT_HOOK_PORT=63084\nOPENCOVE_AGENT_HOOK_TOKEN=abc-123_def\nOPENCOVE_AGENT_HOOK_ENV=production\nOPENCOVE_AGENT_HOOK_VERSION=1\n',
    )
    expect(() =>
      serializeAgentHookEndpoint({
        port: 1,
        token: 'unsafe value',
        environment: 'production',
        version: '1',
      }),
    ).toThrow('shell-safe')
  })

  it('removes inherited coordinates before adding the current PTY identity', () => {
    expect(
      buildCodexHookPtyEnv(
        {
          KEEP: 'yes',
          OPENCOVE_AGENT_HOOK_TOKEN: 'stale',
          OPENCOVE_PANE_KEY: 'stale-pane',
          CODEX_HOME: '/stale/home',
        },
        {
          endpointPath: '/tmp/endpoint.env',
          paneKey: 'pane-1',
          tabId: 'tab-1',
          worktreeId: 'worktree-1',
          codexHome: '/managed/home',
        },
      ),
    ).toEqual({
      KEEP: 'yes',
      OPENCOVE_AGENT_HOOK_ENDPOINT: '/tmp/endpoint.env',
      OPENCOVE_PANE_KEY: 'pane-1',
      OPENCOVE_TAB_ID: 'tab-1',
      OPENCOVE_WORKTREE_ID: 'worktree-1',
      CODEX_HOME: '/managed/home',
    })
  })
})
