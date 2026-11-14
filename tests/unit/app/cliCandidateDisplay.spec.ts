import { quotePromptToken } from '../../../src/shared/errors/initialPromptFeedback'
// @vitest-environment node
import { expect, it } from 'vitest'
import { CliError, printError } from '../../../src/app/cli/core/errors'
import { candidateText, safeTerminalText } from '../../../src/app/cli/core/errorPresentation'
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

const bidiControls = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]
it.each(bidiControls)('escapes bidi control U+%s consistently with prompt tokens', code => {
  const original = 'left' + String.fromCharCode(code) + 'right'
  const expected = 'left\\u' + code.toString(16).padStart(4, '0') + 'right'
  expect(safeTerminalText(original)).toBe(expected)
  expect(safeTerminalText(original)).toBe(quotePromptToken(original).slice(1, -1))
})
it('keeps RTL letters and emoji joining characters readable', () => {
  const original = '中文 العربية עברית 👩\u200d💻'
  expect(safeTerminalText(original)).toBe(original)
})
it('escapes bidi candidate columns while retaining their original JSON text', () => {
  const original = 'label' + bidiControls.map(code => String.fromCharCode(code)).join('')
  const candidates = [{ id: original, kind: original, title: original, spaceName: original }]
  const text = candidateText(candidates)!
  for (const code of bidiControls) {
    expect(text).not.toContain(String.fromCharCode(code))
  }
  const f = identityFixture(false)
  printError(f.io, new CliError('cli.ambiguous', 6, 'Ambiguous', undefined, { candidates }), true)
  expect(f.error().candidates).toEqual(candidates)
  expect(f.error().details.candidates).toEqual(candidates)
})
