// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who, node } from './cliIdentity.helpers'

const summary = 'Agents: 4 of 6 running in your tree; depth 1 of 3\n'
function fixture(tty: boolean) {
  const f = identityFixture()
  f.io.stdout.isTTY = tty
  f.values['system.whoami'] = {
    ...who,
    lineageQuota: {
      depth: 1,
      maxDepth: 3,
      liveInTree: 4,
      maxLiveInTree: 6,
      remainingLiveInTree: 2,
    },
  }
  f.values['node.list'] = {
    nodes: [
      node,
      ...Array.from({ length: 3 }, (_, i) => ({
        ...node,
        id: `neighbor-${i}`,
        kind: 'note',
        title: `Neighbor ${i}`,
      })),
    ],
  }
  return f
}

it('keeps standard list limits and truncation totals in interactive context output', async () => {
  const f = fixture(true)
  expect(await run(['context', '--limit', '1'], f.io)).toBe(0)
  expect(f.out().endsWith(summary)).toBe(true)
  const value = JSON.parse(f.out().slice(0, -summary.length))
  expect(value.nodes).toHaveLength(1)
  expect(value.next).toHaveLength(1)
  expect(value.truncated).toEqual({ nodes: 3, next: 4 })
})

for (const command of ['whoami', 'context']) {
  const fields = command === 'context' ? 'self.lineageQuota,nodes.id,next' : 'lineageQuota,nodeId'
  it.each([
    { flags: [], append: true },
    { flags: ['--limit', '1'], append: true },
    { flags: ['--limit', '0'], append: true },
    { flags: ['--fields', fields], append: false },
    { flags: ['--fields', fields, '--limit', '1'], append: false },
    { flags: ['--pretty'], append: false },
    { flags: ['--pretty', '--limit', '1'], append: false },
    { flags: ['-o', 'json'], append: false },
    { flags: ['-o', 'json', '--pretty', '--limit', '1', '--fields', fields], append: false },
  ])(`${command} preserves standard renderer bytes for $flags`, async ({ flags, append }) => {
    const pipe = fixture(false),
      tty = fixture(true)
    const args = [command, ...flags]
    expect(await run(args, pipe.io)).toBe(0)
    expect(await run(args, tty.io)).toBe(0)
    expect(tty.out()).toBe(pipe.out() + (append ? summary : ''))
  })
  it(`${command} preserves the standard unsupported-table refusal on a TTY`, async () => {
    const pipe = fixture(false),
      tty = fixture(true)
    expect(await run([command, '-o', 'table'], pipe.io)).toBe(2)
    expect(await run([command, '-o', 'table'], tty.io)).toBe(2)
    expect(tty.out()).toBe(pipe.out())
    expect(tty.out()).toBe('')
    expect(tty.error()).toEqual(pipe.error())
    expect(tty.error().message).toContain('Table output is unavailable')
  })
}
