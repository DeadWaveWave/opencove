// @vitest-environment node
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { parseWindowsArguments } from '../../support/windowsCommandLine'
import { serializeWindowsArguments } from '../../../src/platform/process/windowsCommandLine'
const require = createRequire(import.meta.url)
const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent.js') as {
  argsToCommandLine(file: string, args: string | string[]): string
}
const vectors = [
  'update',
  'plugins',
  ' --agent-teams ',
  '$(printf update)',
  '"update"',
  '" --agent-teams "',
  'Explain " --agent-teams " please',
  '',
  'a\t\nb\r\nc',
  '中文 😀',
  'a\\"b',
  'C:\\folder with space\\',
  '"two words"',
  '%PATH% & ^ ! `',
]
it.each(vectors)('preserves final node-pty argument %j', value => {
  const actual = argsToCommandLine('receiver.exe', serializeWindowsArguments([value]))
  expect(parseWindowsArguments(actual)).toEqual(['receiver.exe', value])
})
it('negative control: node-pty array serialization splits quote-enclosed data', () => {
  expect(
    parseWindowsArguments(argsToCommandLine('receiver.exe', ['" --agent-teams "'])),
  ).not.toEqual(['receiver.exe', '" --agent-teams "'])
})
