// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { commands } from '../../../src/app/cli/commands'
import { globals, parseCommand } from '../../../src/app/cli/core/args'
import { run } from '../../../src/app/cli/core/run'
import { shellWord } from '../../../src/app/cli/core/shellWord'
import type { CliIo } from '../../../src/app/cli/core/io'

// Split POSIX literal words while rejecting expansion/redirection in help examples.
// A pipe is allowed only between the existing printf producer and opencove.
function shellWords(source: string): string[] {
  const words: string[] = []
  let word = '',
    quote = '',
    started = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote === "'") {
      if (c === quote) {
        quote = ''
      } else {
        word += c
      }
    } else if (c === '\\') {
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(source[i + 1])) {
        word += c
      } else {
        word += source[++i]
      }
      started = true
    } else if (quote === '"') {
      if (c === quote) {
        quote = ''
      } else {
        if (c === '$' || c === '`') {
          throw new Error(`Unquoted expansion: ${source}`)
        }
        word += c
      }
    } else if (c === "'" || c === '"') {
      quote = c
      started = true
    } else if (/\s/.test(c) || c === '|') {
      if (started) {
        words.push(word)
      }
      word = ''
      started = false
      if (c === '|') {
        words.push(c)
      }
    } else {
      if (/[<>$`;()&*?[\]{}~]/.test(c)) {
        throw new Error(`Unquoted shell character: ${source}`)
      }
      word += c
      started = true
    }
  }
  if (quote) {
    throw new Error(`Unclosed quote: ${source}`)
  }
  if (started) {
    words.push(word)
  }
  return words
}

it.each([
  '$schema',
  '<path|->',
  '$(touch bad)',
  "a'b",
  'two words',
  'https://example.com/?a=1&b=2',
])('quotes literal shell values: %s', value => {
  expect(shellWords(shellWord(value))).toEqual([value])
})

it.each(commands.map(command => [command.path.join(' '), command] as const))(
  'keeps every %s help example option intact through shell splitting',
  async (_name, command) => {
    let out = ''
    const io: CliIo = {
      stdout: {
        write: text => {
          out += text
        },
      },
      stderr: { write: vi.fn() },
      env: {},
      now: Date.now,
      fetch: vi.fn(),
      readTextFile: vi.fn(async () => '{}'),
      readStdinText: vi.fn(async () => '{}'),
    }
    expect(await run([...command.path, '--help'], io)).toBe(0)
    const examples = out
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('opencove ') || line.startsWith('printf '))
    expect(examples.length).toBeGreaterThan(0)
    await Promise.all(
      examples.map(async example => {
        const words = shellWords(example)
        const argv = words.slice(words.indexOf('opencove') + 1)
        const parsed = await parseCommand([...argv, '--help'], command, io)
        const specs = { ...globals, ...command.options }
        for (let i = 0; i < argv.length; i++) {
          if (!argv[i].startsWith('--')) {
            continue
          }
          const key = argv[i].slice(2)
          const spec = specs[key]
          if (!spec || spec.type === 'boolean') {
            continue
          }
          const value = argv[++i]
          if (spec.type === 'string') {
            expect(parsed.options[key]).toEqual(spec.multiple ? [value] : value)
          }
          if (key === 'fields') {
            expect(value).not.toBe('')
          }
        }
        expect(io.fetch).not.toHaveBeenCalled()
      }),
    )
  },
)

it('keeps $schema literal in the schema help projection example', () => {
  expect(shellWords("opencove api schema node.create --fields '$schema'").at(-1)).toBe('$schema')
})
