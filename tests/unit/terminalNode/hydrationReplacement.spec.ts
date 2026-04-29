import { describe, expect, it } from 'vitest'
import {
  containsDestructiveTerminalDisplayControlSequence,
  containsMeaningfulTerminalDisplayContent,
  shouldDeferHydratedTerminalRedrawChunk,
  shouldReplacePlaceholderWithBufferedOutput,
  stripEchoedTerminalControlSequences,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationReplacement'

describe('hydrationReplacement', () => {
  it('treats control-only chunks as non-visible placeholder output', () => {
    expect(containsMeaningfulTerminalDisplayContent('\u001b[I')).toBe(false)
    expect(containsMeaningfulTerminalDisplayContent('\u001b[2J\u001b[H')).toBe(false)
    expect(containsMeaningfulTerminalDisplayContent('\u001b]10;?\u0007')).toBe(false)
    expect(containsMeaningfulTerminalDisplayContent('^[[1;1R^[[?1;2c^[[13;3R^[[I')).toBe(false)
    expect(containsMeaningfulTerminalDisplayContent('\r\n\t   ')).toBe(false)
  })

  it('detects printable content after stripping terminal control sequences', () => {
    expect(containsMeaningfulTerminalDisplayContent('\u001b[31mhello\u001b[0m')).toBe(true)
    expect(containsMeaningfulTerminalDisplayContent('\u001b[2J\u001b[Hready')).toBe(true)
    expect(containsMeaningfulTerminalDisplayContent('\u001b[2J\u001b[H┌ box')).toBe(true)
  })

  it('detects destructive redraw control sequences that should wait for visible follow-up output', () => {
    expect(containsDestructiveTerminalDisplayControlSequence('\u001b[2J\u001b[H')).toBe(true)
    expect(containsDestructiveTerminalDisplayControlSequence('\u001b[?1049h')).toBe(true)
    expect(containsDestructiveTerminalDisplayControlSequence('\u001bc')).toBe(true)
    expect(containsDestructiveTerminalDisplayControlSequence('\u001b[31mhello\u001b[0m')).toBe(
      false,
    )
    expect(shouldDeferHydratedTerminalRedrawChunk('\u001b[2J\u001b[H')).toBe(true)
    expect(shouldDeferHydratedTerminalRedrawChunk('^[[<0;34;22M\u001b[2J\u001b[H')).toBe(true)
    expect(shouldDeferHydratedTerminalRedrawChunk('\u001b[2J\u001b[Hready')).toBe(false)
    expect(shouldDeferHydratedTerminalRedrawChunk('^[[<0;34;22M\u001b[2J\u001b[Hready')).toBe(false)
    expect(shouldDeferHydratedTerminalRedrawChunk('\u001b[K')).toBe(false)
    expect(shouldDeferHydratedTerminalRedrawChunk('ready\u001b[K')).toBe(false)
  })

  it('treats buffered exits as replacement-worthy output', () => {
    expect(
      shouldReplacePlaceholderWithBufferedOutput({
        data: '\u001b[2J\u001b[H',
        exitCode: null,
      }),
    ).toBe(false)
    expect(
      shouldReplacePlaceholderWithBufferedOutput({
        data: '^[[<0;34;22M\u001b[2J\u001b[H',
        exitCode: null,
      }),
    ).toBe(false)
    expect(
      shouldReplacePlaceholderWithBufferedOutput({
        data: '^[[1;1R^[[?1;2c^[[13;3R^[[I',
        exitCode: null,
      }),
    ).toBe(false)
    expect(
      shouldReplacePlaceholderWithBufferedOutput({
        data: '\u001b[2J\u001b[H',
        exitCode: 0,
      }),
    ).toBe(true)
  })

  it('strips echoed terminal control sequences before recovered output replacement', () => {
    expect(stripEchoedTerminalControlSequences('^[[1;1R^[[?1;2c^[[13;3R^[[I')).toBe('')
    expect(stripEchoedTerminalControlSequences('^[[<0;34;22M\u001b[2J\u001b[Hready')).toBe(
      '\u001b[2J\u001b[Hready',
    )
    expect(stripEchoedTerminalControlSequences('^[[1;1Rready')).toBe('ready')
    expect(stripEchoedTerminalControlSequences('before^[[?1;2cafter')).toBe('beforeafter')
  })
})
