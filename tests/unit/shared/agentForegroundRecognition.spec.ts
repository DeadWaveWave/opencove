import { describe, expect, it } from 'vitest'
import {
  recognizeAgentProcessFromCommandLine,
  resolveForegroundAgentReconciliation,
  resolveForegroundAgentObservation,
} from '../../../src/shared/runtime/agentForegroundRecognition'

describe('agent foreground recognition', () => {
  it('recognizes installed package paths and platform binary prefixes', () => {
    expect(
      recognizeAgentProcessFromCommandLine(
        '/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js',
      ),
    ).toBe('codex')
    expect(recognizeAgentProcessFromCommandLine('/tmp/codex-aarch64-apple-darwin --version')).toBe(
      'codex',
    )
    expect(recognizeAgentProcessFromCommandLine('/bin/zsh -l')).toBeNull()
  })

  it('resolves available agent, available shell-only, and unavailable snapshots', () => {
    const agent = resolveForegroundAgentObservation(
      '100 1 Ss /bin/zsh -l\n120 100 S+ /opt/pkg/node_modules/@openai/codex/bin/codex.js\n',
      100,
    )
    expect(agent).toEqual({ availability: 'available', agent: 'codex', shellOnly: false })

    const shell = resolveForegroundAgentObservation('100 1 Ss+ /bin/zsh -l\n', 100)
    expect(shell).toEqual({ availability: 'available', agent: null, shellOnly: true })

    expect(resolveForegroundAgentObservation('garbled', 100)).toEqual({
      availability: 'unavailable',
      agent: null,
      shellOnly: false,
    })
  })

  it('INV-1 keeps an optimistic overlay when process scanning is unavailable', () => {
    expect(
      resolveForegroundAgentReconciliation({
        sessionId: 'session-1',
        observedAtMs: 100,
        source: 'process_scan',
        exitCode: null,
        availability: 'unavailable',
        agent: null,
        shellOnly: false,
      }),
    ).toBe('keep')
  })

  it('INV-2 clears after an available scan proves no codex foreground process', () => {
    expect(
      resolveForegroundAgentReconciliation({
        sessionId: 'session-1',
        observedAtMs: 100,
        source: 'process_scan',
        exitCode: null,
        availability: 'available',
        agent: null,
        shellOnly: true,
      }),
    ).toBe('clear')
  })

  it('INV-3 confirms a detected codex foreground process without clearing', () => {
    expect(
      resolveForegroundAgentReconciliation({
        sessionId: 'session-1',
        observedAtMs: 100,
        source: 'process_scan',
        exitCode: null,
        availability: 'available',
        agent: 'codex',
        shellOnly: false,
      }),
    ).toBe('confirm')
  })

  it('keeps unavailable process scans distinct from bounded Windows completion fallback', () => {
    expect(
      resolveForegroundAgentReconciliation({
        sessionId: 'session-1',
        observedAtMs: 100,
        source: 'windows_prompt_timeout',
        exitCode: null,
        availability: 'unavailable',
        agent: null,
        shellOnly: false,
      }),
    ).toBe('clear')
  })
})
