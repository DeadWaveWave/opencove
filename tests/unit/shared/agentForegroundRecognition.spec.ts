import { describe, expect, it } from 'vitest'
import {
  recognizeAgentProcessFromCommandLine,
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

  it('clears only after a complete scan proves the shell owns the foreground', () => {
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
})
