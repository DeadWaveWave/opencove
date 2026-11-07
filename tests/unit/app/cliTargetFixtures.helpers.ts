import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'

/** Existing payload/output tests use short synthetic IDs. Supply identity and
 * selector reads separately so their transport spy continues to describe the target
 * operation. cliIdentity.spec.ts tests real selector traffic without this adapter. */
export function runWithTargetFixtures(argv: string[], io: CliIo) {
  const pending = new Map<string, string>()
  for (const kind of ['node', 'space', 'project']) {
    const index = argv.indexOf(`--${kind}`)
    const value =
      index >= 0
        ? argv[index + 1]
        : argv.find(arg => arg.startsWith(`--${kind}=`))?.slice(kind.length + 3)
    if (value && value !== '@self') {
      pending.set(`${kind}.list`, value)
    }
  }
  return run(argv, {
    ...io,
    fetch: async (url, init) => {
      const { id } = JSON.parse(String(init?.body))
      if (id === 'system.whoami' && (pending.has('node.list') || pending.has('space.list'))) {
        return new Response(
          JSON.stringify({ ok: true, value: { kind: 'bearer', scopeTier: 'admin' } }),
        )
      }
      const target = pending.get(id)
      if (target) {
        pending.delete(id)
        const key = id === 'space.list' ? 'spaces' : id.replace('.list', 's')
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              [key]: [{ id: target, name: target, title: target }],
            },
          }),
        )
      }
      return io.fetch(url, init)
    },
  })
}
