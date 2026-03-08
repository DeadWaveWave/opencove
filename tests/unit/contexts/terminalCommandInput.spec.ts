import { describe, expect, it } from 'vitest'
import {
  createTerminalCommandInputState,
  parseTerminalCommandInput,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/commandInput'

describe('parseTerminalCommandInput', () => {
  it('emits a command when enter is pressed', () => {
    const parsed = parseTerminalCommandInput('npm run dev\r', createTerminalCommandInputState())

    expect(parsed.commands).toEqual(['npm run dev'])
    expect(parsed.nextState.lineBuffer).toBe('')
  })

  it('keeps partial input across chunks', () => {
    const first = parseTerminalCommandInput('git status', createTerminalCommandInputState())
    expect(first.commands).toEqual([])

    const second = parseTerminalCommandInput('\r', first.nextState)
    expect(second.commands).toEqual(['git status'])
  })

  it('handles backspace and control-word deletion', () => {
    const parsed = parseTerminalCommandInput(
      'echo hellp\u007fo world\u0017cove\r',
      createTerminalCommandInputState(),
    )

    expect(parsed.commands).toEqual(['echo hello cove'])
  })

  it('ignores escape sequences from cursor movement and OSC', () => {
    const parsed = parseTerminalCommandInput(
      '\u001b]0;title\u0007ls\u001b[D\u001b[C\r',
      createTerminalCommandInputState(),
    )

    expect(parsed.commands).toEqual(['ls'])
  })

  it('tracks cursor-left edits and emits the final submitted command', () => {
    const parsed = parseTerminalCommandInput(
      'echo wrld\u001b[3Do\r',
      createTerminalCommandInputState(),
    )

    expect(parsed.commands).toEqual(['echo world'])
  })

  it('applies backspace at the cursor position after navigation', () => {
    const parsed = parseTerminalCommandInput(
      'gitx status\u001b[7D\u007f\r',
      createTerminalCommandInputState(),
    )

    expect(parsed.commands).toEqual(['git status'])
  })

  it('clears the pending line on Ctrl+C and captures the next command', () => {
    const parsed = parseTerminalCommandInput(
      'temporary\u0003pwd\r',
      createTerminalCommandInputState(),
    )

    expect(parsed.commands).toEqual(['pwd'])
  })
})
