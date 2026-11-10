// @vitest-environment node
import { expect, it } from 'vitest'
import { CliError, printError } from '../../../src/app/cli/core/errors'
import { candidateText } from '../../../src/app/cli/core/errorPresentation'
import { identityFixture, node, space } from './cliIdentity.helpers'
import { run } from '../../../src/app/cli/core/run'

const unsafe = '\x1b]0;forged\x07\x1b[2J\r\nforged row\t\b\x7f\x9b2J\x9dtitle\x9c\u2028\u2029'
it.each(['id', 'kind', 'title', 'name', 'spaceName', 'directoryPath'])(
  'escapes controls in candidate %s without adding rows',
  field => {
    const text = candidateText([{ [field]: unsafe }, { id: 'safe', title: '中文 🙂' }])!
    expect(text.trimEnd().split('\n')).toHaveLength(3)
    expect(text.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\u2028\u2029]/u)
    expect(text).toContain('\\u001b')
    expect(text).toContain('\\r\\n')
    expect(text).toContain('中文 🙂')
  },
)
it('preserves original JSON candidate values', () => {
  const f = identityFixture(false)
  const candidates = [{ id: 'n', title: unsafe, spaceName: unsafe }]
  printError(f.io, new CliError('cli.ambiguous', 6, 'Ambiguous', undefined, { candidates }), true)
  expect(f.error().candidates).toEqual(candidates)
  expect(f.error().details.candidates).toEqual(candidates)
})
it('does not execute Space name escapes in the real ambiguity route', async () => {
  const f = identityFixture(false)
  let stderr = ''
  f.io.stderr = {
    isTTY: true,
    write: value => {
      stderr += value
    },
  }
  f.values['node.list'] = {
    nodes: [
      { ...node, title: 'Review' },
      { ...node, id: 'second', title: 'Review', spaceId: 'other' },
    ],
  }
  f.values['space.list'] = {
    spaces: [
      { ...space, name: unsafe },
      { ...space, id: 'other', name: 'Other' },
    ],
  }
  expect(await run(['node', 'get', '--node', 'Review'], f.io)).toBe(6)
  expect(stderr).not.toContain('\x1b')
  expect(stderr).not.toContain('\r')
  expect(stderr).not.toContain('\x9d')
  expect(stderr).toContain('\\u001b')
  expect(stderr.trimEnd().split('\n')).toHaveLength(5)
})
