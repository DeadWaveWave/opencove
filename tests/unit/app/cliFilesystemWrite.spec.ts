// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'

it.each(
  [undefined, 'mount-123456'].flatMap(mount =>
    [
      { content: '', bytes: 0 },
      { content: '  hello\n', bytes: 8 },
      { content: '你好 🌊\r\n', bytes: 13 },
    ].map(value => ({ mount, ...value })),
  ),
)(
  'returns a newline-terminated UTF-8 write receipt ($mount, $content)',
  async ({ mount, content, bytes }) => {
    const f = identityFixture(false)
    f.values[mount ? 'filesystem.writeFileTextInMount' : 'filesystem.writeFileText'] = null
    const uri = 'file:///repo/notes.txt'
    expect(
      await run(
        ['fs', 'write', '--uri', uri, '--content', content, ...(mount ? ['--mount', mount] : [])],
        f.io,
      ),
    ).toBe(0)
    expect(f.out()).toBe(JSON.stringify({ uri, bytes }) + '\n')
    expect(f.requests.at(-1)?.payload).toMatchObject({ uri, content })
  },
)
it('does not print a write receipt when the Worker rejects the write', async () => {
  const f = identityFixture(false)
  f.io.fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: { code: 'common.unexpected' } }))
  expect(
    await run(['fs', 'write', '--uri', 'file:///repo/notes.txt', '--content', 'hello'], f.io),
  ).toBe(1)
  expect(f.out()).toBe('')
})
