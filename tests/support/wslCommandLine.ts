import { parseWindowsArguments } from './windowsCommandLine'

// Portions adapted from Microsoft WSL. Copyright (c) Microsoft Corporation.
// SPDX-License-Identifier: MIT
// Port of microsoft/WSL helpers.cpp ParseArgument / ConsumeArgument (606-623, 237-243)
// and WslClient.cpp ParseLegacyArguments / WslMain (976-990, 1445-1524, 1675-1711).
// https://github.com/microsoft/WSL/blob/master/src/windows/common/WslClient.cpp
// This scans the raw CreateProcess command line. Never CRT-decode WSL options first.
function parseArgument(line: string, handleQuotes = false): string {
  const whitespace = line.search(/[ \t]/u)
  let argument = whitespace < 0 ? line : line.slice(0, whitespace)
  if (handleQuotes && line.startsWith('"')) {
    const quote = line.indexOf('"', 1)
    if (quote >= 0) {
      argument = line.slice(0, quote + 1)
    }
  }
  return argument
}
function consume(line: string, argument: string): string {
  return line.slice(argument.length).replace(/^[ \t\r\n]+/u, '')
}
function executableEnd(line: string): number {
  let quoted = false
  let i = 0
  while (i < line.length && (quoted || !/[ \t\r\n]/u.test(line[i]))) {
    if (line[i] === '"') {
      quoted = !quoted
    }
    i++
  }
  return i
}

/** CommandLineToArgvW: argv[0] uses executable-name rules, subsequent args use slash parity. */
function parseExecArguments(line: string): string[] {
  let end: number
  let executable: string
  if (line.startsWith('"')) {
    end = line.indexOf('"', 1)
    if (end < 0) {
      end = line.length
    }
    executable = line.slice(1, end)
    if (end < line.length) {
      end++
    }
  } else {
    end = line.search(/[ \t]/u)
    if (end < 0) {
      end = line.length
    }
    executable = line.slice(0, end)
  }
  return [executable, ...parseWindowsArguments(line.slice(end))]
}

export function parseWslCommandLine(raw: string) {
  let line = raw.slice(executableEnd(raw)).replace(/^[ \t\r\n]+/u, '')
  const switches: string[] = []
  let distro: string | undefined
  let cwd: string | undefined
  for (;;) {
    const argument = parseArgument(line)
    if (!argument) {
      break
    }
    if (argument === '--exec' || argument === '-e') {
      switches.push(argument)
      line = consume(line, argument)
      return { mode: 'exec', switches, distro, cwd, argv: parseExecArguments(line), shell: '' }
    }
    if (['--distribution', '-d', '--user', '-u', '--distribution-id', '--cd'].includes(argument)) {
      switches.push(argument)
      line = consume(line, argument)
      const value = parseArgument(line, argument === '--cd')
      if (!value) {
        throw new Error('Missing WSL option value')
      }
      if (argument === '--distribution' || argument === '-d') {
        distro = value
      }
      if (argument === '--cd') {
        cwd = value.replace(/^"|"$/gu, '')
      }
      line = consume(line, value)
      continue
    }
    if (argument === '--') {
      line = consume(line, argument)
    } else if (argument.startsWith('-')) {
      throw new Error('Unknown WSL switch')
    }
    break
  }
  return { mode: 'shell', switches, distro, cwd, argv: [], shell: line }
}
