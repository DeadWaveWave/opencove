/**
 * VT500 transition rules adapted from xterm.js 6.0.0 EscapeSequenceParser.ts.
 * Keep in parity with the pinned parser; only mode-affecting dispatches are consumed.
 *
 * Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
 * Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
 * Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
export const enum ParserState {
  GROUND = 0,
  ESCAPE = 1,
  ESCAPE_INTERMEDIATE = 2,
  CSI_ENTRY = 3,
  CSI_PARAM = 4,
  CSI_INTERMEDIATE = 5,
  CSI_IGNORE = 6,
  SOS_PM_APC_STRING = 7,
  OSC_STRING = 8,
  DCS_ENTRY = 9,
  DCS_PARAM = 10,
  DCS_IGNORE = 11,
  DCS_INTERMEDIATE = 12,
  DCS_PASSTHROUGH = 13,
}

/**
 * Internal actions of EscapeSequenceParser.
 */
export const enum ParserAction {
  IGNORE = 0,
  ERROR = 1,
  PRINT = 2,
  EXECUTE = 3,
  OSC_START = 4,
  OSC_PUT = 5,
  OSC_END = 6,
  CSI_DISPATCH = 7,
  PARAM = 8,
  COLLECT = 9,
  ESC_DISPATCH = 10,
  CLEAR = 11,
  DCS_HOOK = 12,
  DCS_PUT = 13,
  DCS_UNHOOK = 14,
}

export class TransitionTable {
  public table: Uint8Array

  constructor(length: number) {
    this.table = new Uint8Array(length)
  }

  /**
   * Set default transition.
   * @param action default action
   * @param next default next state
   */
  public setDefault(action: ParserAction, next: ParserState): void {
    this.table.fill((action << 4) | next)
  }

  /**
   * Add a transition to the transition table.
   * @param code input character code
   * @param state current parser state
   * @param action parser action to be done
   * @param next next parser state
   */
  public add(code: number, state: ParserState, action: ParserAction, next: ParserState): void {
    this.table[(state << 8) | code] = (action << 4) | next
  }

  /**
   * Add transitions for multiple input character codes.
   * @param codes input character code array
   * @param state current parser state
   * @param action parser action to be done
   * @param next next parser state
   */
  public addMany(
    codes: number[],
    state: ParserState,
    action: ParserAction,
    next: ParserState,
  ): void {
    for (let i = 0; i < codes.length; i++) {
      this.table[(state << 8) | codes[i]] = (action << 4) | next
    }
  }
}

const NON_ASCII_PRINTABLE = 0xa0

/**
 * VT500 compatible transition table.
 * Taken from https://vt100.net/emu/dec_ansi_parser.
 */
export const VT500_TRANSITION_TABLE = (function (): TransitionTable {
  const table: TransitionTable = new TransitionTable(4095)

  // range macro for byte
  const BYTE_VALUES = 256
  const blueprint = Array.from({ length: BYTE_VALUES }, (_, i) => i)
  const r = (start: number, end: number): number[] => blueprint.slice(start, end)

  // Default definitions.
  const PRINTABLES = r(0x20, 0x7f) // 0x20 (SP) included, 0x7F (DEL) excluded
  const EXECUTABLES = r(0x00, 0x18)
  EXECUTABLES.push(0x19)
  EXECUTABLES.push.apply(EXECUTABLES, r(0x1c, 0x20))

  const states: number[] = r(ParserState.GROUND, ParserState.DCS_PASSTHROUGH + 1)

  // set default transition
  table.setDefault(ParserAction.ERROR, ParserState.GROUND)
  // printables
  table.addMany(PRINTABLES, ParserState.GROUND, ParserAction.PRINT, ParserState.GROUND)
  // global anywhere rules
  for (const state of states) {
    table.addMany([0x18, 0x1a, 0x99, 0x9a], state, ParserAction.EXECUTE, ParserState.GROUND)
    table.addMany(r(0x80, 0x90), state, ParserAction.EXECUTE, ParserState.GROUND)
    table.addMany(r(0x90, 0x98), state, ParserAction.EXECUTE, ParserState.GROUND)
    table.add(0x9c, state, ParserAction.IGNORE, ParserState.GROUND) // ST as terminator
    table.add(0x1b, state, ParserAction.CLEAR, ParserState.ESCAPE) // ESC
    table.add(0x9d, state, ParserAction.OSC_START, ParserState.OSC_STRING) // OSC
    table.addMany([0x98, 0x9e, 0x9f], state, ParserAction.IGNORE, ParserState.SOS_PM_APC_STRING)
    table.add(0x9b, state, ParserAction.CLEAR, ParserState.CSI_ENTRY) // CSI
    table.add(0x90, state, ParserAction.CLEAR, ParserState.DCS_ENTRY) // DCS
  }
  // rules for executables and 7f
  table.addMany(EXECUTABLES, ParserState.GROUND, ParserAction.EXECUTE, ParserState.GROUND)
  table.addMany(EXECUTABLES, ParserState.ESCAPE, ParserAction.EXECUTE, ParserState.ESCAPE)
  table.add(0x7f, ParserState.ESCAPE, ParserAction.IGNORE, ParserState.ESCAPE)
  table.addMany(EXECUTABLES, ParserState.OSC_STRING, ParserAction.IGNORE, ParserState.OSC_STRING)
  table.addMany(EXECUTABLES, ParserState.CSI_ENTRY, ParserAction.EXECUTE, ParserState.CSI_ENTRY)
  table.add(0x7f, ParserState.CSI_ENTRY, ParserAction.IGNORE, ParserState.CSI_ENTRY)
  table.addMany(EXECUTABLES, ParserState.CSI_PARAM, ParserAction.EXECUTE, ParserState.CSI_PARAM)
  table.add(0x7f, ParserState.CSI_PARAM, ParserAction.IGNORE, ParserState.CSI_PARAM)
  table.addMany(EXECUTABLES, ParserState.CSI_IGNORE, ParserAction.EXECUTE, ParserState.CSI_IGNORE)
  table.addMany(
    EXECUTABLES,
    ParserState.CSI_INTERMEDIATE,
    ParserAction.EXECUTE,
    ParserState.CSI_INTERMEDIATE,
  )
  table.add(0x7f, ParserState.CSI_INTERMEDIATE, ParserAction.IGNORE, ParserState.CSI_INTERMEDIATE)
  table.addMany(
    EXECUTABLES,
    ParserState.ESCAPE_INTERMEDIATE,
    ParserAction.EXECUTE,
    ParserState.ESCAPE_INTERMEDIATE,
  )
  table.add(
    0x7f,
    ParserState.ESCAPE_INTERMEDIATE,
    ParserAction.IGNORE,
    ParserState.ESCAPE_INTERMEDIATE,
  )
  // osc
  table.add(0x5d, ParserState.ESCAPE, ParserAction.OSC_START, ParserState.OSC_STRING)
  table.addMany(PRINTABLES, ParserState.OSC_STRING, ParserAction.OSC_PUT, ParserState.OSC_STRING)
  table.add(0x7f, ParserState.OSC_STRING, ParserAction.OSC_PUT, ParserState.OSC_STRING)
  table.addMany(
    [0x9c, 0x1b, 0x18, 0x1a, 0x07],
    ParserState.OSC_STRING,
    ParserAction.OSC_END,
    ParserState.GROUND,
  )
  table.addMany(r(0x1c, 0x20), ParserState.OSC_STRING, ParserAction.IGNORE, ParserState.OSC_STRING)
  // sos/pm/apc does nothing
  table.addMany(
    [0x58, 0x5e, 0x5f],
    ParserState.ESCAPE,
    ParserAction.IGNORE,
    ParserState.SOS_PM_APC_STRING,
  )
  table.addMany(
    PRINTABLES,
    ParserState.SOS_PM_APC_STRING,
    ParserAction.IGNORE,
    ParserState.SOS_PM_APC_STRING,
  )
  table.addMany(
    EXECUTABLES,
    ParserState.SOS_PM_APC_STRING,
    ParserAction.IGNORE,
    ParserState.SOS_PM_APC_STRING,
  )
  table.add(0x9c, ParserState.SOS_PM_APC_STRING, ParserAction.IGNORE, ParserState.GROUND)
  table.add(0x7f, ParserState.SOS_PM_APC_STRING, ParserAction.IGNORE, ParserState.SOS_PM_APC_STRING)
  // csi entries
  table.add(0x5b, ParserState.ESCAPE, ParserAction.CLEAR, ParserState.CSI_ENTRY)
  table.addMany(r(0x40, 0x7f), ParserState.CSI_ENTRY, ParserAction.CSI_DISPATCH, ParserState.GROUND)
  table.addMany(r(0x30, 0x3c), ParserState.CSI_ENTRY, ParserAction.PARAM, ParserState.CSI_PARAM)
  table.addMany(
    [0x3c, 0x3d, 0x3e, 0x3f],
    ParserState.CSI_ENTRY,
    ParserAction.COLLECT,
    ParserState.CSI_PARAM,
  )
  table.addMany(r(0x30, 0x3c), ParserState.CSI_PARAM, ParserAction.PARAM, ParserState.CSI_PARAM)
  table.addMany(r(0x40, 0x7f), ParserState.CSI_PARAM, ParserAction.CSI_DISPATCH, ParserState.GROUND)
  table.addMany(
    [0x3c, 0x3d, 0x3e, 0x3f],
    ParserState.CSI_PARAM,
    ParserAction.IGNORE,
    ParserState.CSI_IGNORE,
  )
  table.addMany(r(0x20, 0x40), ParserState.CSI_IGNORE, ParserAction.IGNORE, ParserState.CSI_IGNORE)
  table.add(0x7f, ParserState.CSI_IGNORE, ParserAction.IGNORE, ParserState.CSI_IGNORE)
  table.addMany(r(0x40, 0x7f), ParserState.CSI_IGNORE, ParserAction.IGNORE, ParserState.GROUND)
  table.addMany(
    r(0x20, 0x30),
    ParserState.CSI_ENTRY,
    ParserAction.COLLECT,
    ParserState.CSI_INTERMEDIATE,
  )
  table.addMany(
    r(0x20, 0x30),
    ParserState.CSI_INTERMEDIATE,
    ParserAction.COLLECT,
    ParserState.CSI_INTERMEDIATE,
  )
  table.addMany(
    r(0x30, 0x40),
    ParserState.CSI_INTERMEDIATE,
    ParserAction.IGNORE,
    ParserState.CSI_IGNORE,
  )
  table.addMany(
    r(0x40, 0x7f),
    ParserState.CSI_INTERMEDIATE,
    ParserAction.CSI_DISPATCH,
    ParserState.GROUND,
  )
  table.addMany(
    r(0x20, 0x30),
    ParserState.CSI_PARAM,
    ParserAction.COLLECT,
    ParserState.CSI_INTERMEDIATE,
  )
  // esc_intermediate
  table.addMany(
    r(0x20, 0x30),
    ParserState.ESCAPE,
    ParserAction.COLLECT,
    ParserState.ESCAPE_INTERMEDIATE,
  )
  table.addMany(
    r(0x20, 0x30),
    ParserState.ESCAPE_INTERMEDIATE,
    ParserAction.COLLECT,
    ParserState.ESCAPE_INTERMEDIATE,
  )
  table.addMany(
    r(0x30, 0x7f),
    ParserState.ESCAPE_INTERMEDIATE,
    ParserAction.ESC_DISPATCH,
    ParserState.GROUND,
  )
  table.addMany(r(0x30, 0x50), ParserState.ESCAPE, ParserAction.ESC_DISPATCH, ParserState.GROUND)
  table.addMany(r(0x51, 0x58), ParserState.ESCAPE, ParserAction.ESC_DISPATCH, ParserState.GROUND)
  table.addMany(
    [0x59, 0x5a, 0x5c],
    ParserState.ESCAPE,
    ParserAction.ESC_DISPATCH,
    ParserState.GROUND,
  )
  table.addMany(r(0x60, 0x7f), ParserState.ESCAPE, ParserAction.ESC_DISPATCH, ParserState.GROUND)
  // dcs entry
  table.add(0x50, ParserState.ESCAPE, ParserAction.CLEAR, ParserState.DCS_ENTRY)
  table.addMany(EXECUTABLES, ParserState.DCS_ENTRY, ParserAction.IGNORE, ParserState.DCS_ENTRY)
  table.add(0x7f, ParserState.DCS_ENTRY, ParserAction.IGNORE, ParserState.DCS_ENTRY)
  table.addMany(r(0x1c, 0x20), ParserState.DCS_ENTRY, ParserAction.IGNORE, ParserState.DCS_ENTRY)
  table.addMany(
    r(0x20, 0x30),
    ParserState.DCS_ENTRY,
    ParserAction.COLLECT,
    ParserState.DCS_INTERMEDIATE,
  )
  table.addMany(r(0x30, 0x3c), ParserState.DCS_ENTRY, ParserAction.PARAM, ParserState.DCS_PARAM)
  table.addMany(
    [0x3c, 0x3d, 0x3e, 0x3f],
    ParserState.DCS_ENTRY,
    ParserAction.COLLECT,
    ParserState.DCS_PARAM,
  )
  table.addMany(EXECUTABLES, ParserState.DCS_IGNORE, ParserAction.IGNORE, ParserState.DCS_IGNORE)
  table.addMany(r(0x20, 0x80), ParserState.DCS_IGNORE, ParserAction.IGNORE, ParserState.DCS_IGNORE)
  table.addMany(r(0x1c, 0x20), ParserState.DCS_IGNORE, ParserAction.IGNORE, ParserState.DCS_IGNORE)
  table.addMany(EXECUTABLES, ParserState.DCS_PARAM, ParserAction.IGNORE, ParserState.DCS_PARAM)
  table.add(0x7f, ParserState.DCS_PARAM, ParserAction.IGNORE, ParserState.DCS_PARAM)
  table.addMany(r(0x1c, 0x20), ParserState.DCS_PARAM, ParserAction.IGNORE, ParserState.DCS_PARAM)
  table.addMany(r(0x30, 0x3c), ParserState.DCS_PARAM, ParserAction.PARAM, ParserState.DCS_PARAM)
  table.addMany(
    [0x3c, 0x3d, 0x3e, 0x3f],
    ParserState.DCS_PARAM,
    ParserAction.IGNORE,
    ParserState.DCS_IGNORE,
  )
  table.addMany(
    r(0x20, 0x30),
    ParserState.DCS_PARAM,
    ParserAction.COLLECT,
    ParserState.DCS_INTERMEDIATE,
  )
  table.addMany(
    EXECUTABLES,
    ParserState.DCS_INTERMEDIATE,
    ParserAction.IGNORE,
    ParserState.DCS_INTERMEDIATE,
  )
  table.add(0x7f, ParserState.DCS_INTERMEDIATE, ParserAction.IGNORE, ParserState.DCS_INTERMEDIATE)
  table.addMany(
    r(0x1c, 0x20),
    ParserState.DCS_INTERMEDIATE,
    ParserAction.IGNORE,
    ParserState.DCS_INTERMEDIATE,
  )
  table.addMany(
    r(0x20, 0x30),
    ParserState.DCS_INTERMEDIATE,
    ParserAction.COLLECT,
    ParserState.DCS_INTERMEDIATE,
  )
  table.addMany(
    r(0x30, 0x40),
    ParserState.DCS_INTERMEDIATE,
    ParserAction.IGNORE,
    ParserState.DCS_IGNORE,
  )
  table.addMany(
    r(0x40, 0x7f),
    ParserState.DCS_INTERMEDIATE,
    ParserAction.DCS_HOOK,
    ParserState.DCS_PASSTHROUGH,
  )
  table.addMany(
    r(0x40, 0x7f),
    ParserState.DCS_PARAM,
    ParserAction.DCS_HOOK,
    ParserState.DCS_PASSTHROUGH,
  )
  table.addMany(
    r(0x40, 0x7f),
    ParserState.DCS_ENTRY,
    ParserAction.DCS_HOOK,
    ParserState.DCS_PASSTHROUGH,
  )
  table.addMany(
    EXECUTABLES,
    ParserState.DCS_PASSTHROUGH,
    ParserAction.DCS_PUT,
    ParserState.DCS_PASSTHROUGH,
  )
  table.addMany(
    PRINTABLES,
    ParserState.DCS_PASSTHROUGH,
    ParserAction.DCS_PUT,
    ParserState.DCS_PASSTHROUGH,
  )
  table.add(0x7f, ParserState.DCS_PASSTHROUGH, ParserAction.IGNORE, ParserState.DCS_PASSTHROUGH)
  table.addMany(
    [0x1b, 0x9c, 0x18, 0x1a],
    ParserState.DCS_PASSTHROUGH,
    ParserAction.DCS_UNHOOK,
    ParserState.GROUND,
  )
  // special handling of unicode chars
  table.add(NON_ASCII_PRINTABLE, ParserState.GROUND, ParserAction.PRINT, ParserState.GROUND)
  table.add(
    NON_ASCII_PRINTABLE,
    ParserState.OSC_STRING,
    ParserAction.OSC_PUT,
    ParserState.OSC_STRING,
  )
  table.add(
    NON_ASCII_PRINTABLE,
    ParserState.CSI_IGNORE,
    ParserAction.IGNORE,
    ParserState.CSI_IGNORE,
  )
  table.add(
    NON_ASCII_PRINTABLE,
    ParserState.DCS_IGNORE,
    ParserAction.IGNORE,
    ParserState.DCS_IGNORE,
  )
  table.add(
    NON_ASCII_PRINTABLE,
    ParserState.DCS_PASSTHROUGH,
    ParserAction.DCS_PUT,
    ParserState.DCS_PASSTHROUGH,
  )
  return table
})()
