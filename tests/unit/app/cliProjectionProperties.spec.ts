// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'

const names = ['constructor', 'toString', '__proto__']
const modes = ['json', 'tty', 'tty-json'] as const
type Mode = (typeof modes)[number]

function fixture(value: unknown, mode: Mode) {
  let out = '',
    err = ''
  const fetch = vi.fn(
    async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value })),
  )
  const io: CliIo = {
    stdout: {
      write: text => {
        out += text
      },
    },
    stderr: {
      isTTY: mode !== 'json',
      write: text => {
        err += text
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'test' },
    fetch,
    now: Date.now,
    readTextFile: vi.fn(),
    readStdinText: vi.fn(),
  }
  return { io, fetch, out: () => out, err: () => err }
}

function assertDiagnostic(text: string, mode: Mode, message: string) {
  expect(text).not.toMatch(/native code|key\.split|cli\.failed|function\s*\(/)
  if (mode === 'tty') {
    expect(text).toContain(`error[cli.usage]: ${message}`)
  } else {
    expect(JSON.parse(text).error).toMatchObject({
      code: 'cli.usage',
      message: expect.stringContaining(message),
    })
  }
}

it.each(
  ['node.get', 'node.list'].flatMap(operation =>
    names.flatMap(field => modes.map(mode => ({ operation, field, mode }))),
  ),
)(
  'rejects inherited aliases in $operation for $field ($mode)',
  async ({ operation, field, mode }) => {
    const f = fixture(
      operation === 'node.get' ? { node: { id: 'n' } } : { nodes: [{ id: 'n' }] },
      mode,
    )
    expect(
      await run(
        [
          'api',
          'call',
          operation,
          '--input',
          operation === 'node.get' ? '{"nodeId":"n"}' : '{}',
          '--fields',
          field,
          ...(mode === 'tty-json' ? ['-o', 'json'] : []),
        ],
        f.io,
      ),
    ).toBe(2)
    expect(f.out()).toBe('')
    assertDiagnostic(f.err(), mode, `Unknown output paths: ${field}. Available raw paths:`)
    expect(f.err()).toContain(operation === 'node.get' ? 'node.id' : 'nodes.id')
    if (mode === 'tty') {
      expect(f.err()).toContain(
        `hint: Item-relative paths use the ${operation === 'node.get' ? 'node' : 'nodes'} prefix`,
      )
    } else {
      expect(typeof JSON.parse(f.err()).error.hint).toBe('string')
    }
    expect(f.fetch).toHaveBeenCalledOnce()
  },
)

it.each(names.flatMap(field => modes.map(mode => ({ field, mode }))))(
  'rejects inherited dedicated hints for $field ($mode)',
  async ({ field, mode }) => {
    const f = fixture({}, mode)
    expect(
      await run(
        ['node', 'list', '--fields', field, ...(mode === 'tty-json' ? ['-o', 'json'] : [])],
        f.io,
      ),
    ).toBe(2)
    expect(f.out()).toBe('')
    assertDiagnostic(f.err(), mode, `Unknown fields: ${field}. Available fields:`)
    expect(f.err()).toContain('id, kind, title')
    if (mode === 'tty') {
      expect(f.err()).not.toContain('hint:')
    } else {
      expect(JSON.parse(f.err()).error).not.toHaveProperty('hint')
    }
    expect(f.fetch).not.toHaveBeenCalled()
  },
)

it.each(modes)('retains a declared hint after an inherited name (%s)', async mode => {
  const f = fixture({}, mode)
  expect(
    await run(
      [
        'node',
        'list',
        '--fields',
        'toString,data.text',
        ...(mode === 'tty-json' ? ['-o', 'json'] : []),
      ],
      f.io,
    ),
  ).toBe(2)
  assertDiagnostic(f.err(), mode, 'Unknown fields: toString, data.text. Available fields:')
  expect(f.err()).toContain('opencove node get --node <id> --fields data.text')
  expect(f.out()).toBe('')
})

it.each(names)('preserves legitimate own response properties named %s', async field => {
  const own = Object.fromEntries([[field, { content: 'kept' }]])
  const value = { ...own, node: own }
  const f = fixture(value, 'json')
  expect(
    await run(
      [
        'api',
        'call',
        'node.get',
        '--input',
        '{"nodeId":"n"}',
        '--fields',
        `${field},node.${field}`,
      ],
      f.io,
    ),
  ).toBe(0)
  const projected = JSON.parse(f.out())
  expect(projected).toEqual(value)
  expect(Object.hasOwn(projected, field)).toBe(true)
  expect(Object.hasOwn(projected.node, field)).toBe(true)
  expect(f.err()).toBe('')
})
