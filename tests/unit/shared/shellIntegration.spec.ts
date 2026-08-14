import { describe, expect, it } from 'vitest'
import { resolveShellCommandFinishedMarker } from '../../../src/shared/terminal/shellIntegration'

describe('shell integration command-finished markers', () => {
  it('parses OSC 133;D exit codes terminated by BEL or ST', () => {
    expect(resolveShellCommandFinishedMarker('\u001b]133;D;127\u0007')).toEqual({ exitCode: 127 })
    expect(resolveShellCommandFinishedMarker('\u001b]133;D;0\u001b\\')).toEqual({ exitCode: 0 })
  })

  it('preserves completion evidence when no exit code is present', () => {
    expect(resolveShellCommandFinishedMarker('before\u001b]133;D\u0007after')).toEqual({
      exitCode: null,
    })
    expect(resolveShellCommandFinishedMarker('\u001b]133;D;unsupported=value\u0007')).toEqual({
      exitCode: null,
    })
    expect(resolveShellCommandFinishedMarker('ordinary output')).toBeNull()
  })
})
