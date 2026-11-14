import { it } from 'vitest'
import { Client } from '../../support/convergence/client'
import type { Action } from '../../support/convergence/model'
import type { Adapter } from '../../support/convergence/server'
const histories: Action[][] = [
  ['begin-connect-read', 'delete-terminal', 'schedule', 'release-connect-read', 'refresh', 'flush'],
  [
    'begin-connect-read',
    'move-node',
    'title',
    'rename',
    'schedule',
    'release-connect-read',
    'refresh',
    'flush',
  ],
  ['rebind', 'mount-renderer', 'refresh', 'rename', 'flush'],
  ['startup-refusal', 'rebind', 'worker-upgrade', 'refresh', 'rename', 'flush'],
  ['connect-delivery', 'rebind', 'refresh', 'rename', 'flush', 'refresh'],
  [
    'connect-delivery',
    'disconnect-delivery',
    'rebind',
    'restart-worker',
    'connect-delivery',
    'rename',
    'flush',
    'refresh',
  ],
  ['disconnect-delivery', 'rebind', 'rename', 'flush', 'connect-delivery', 'refresh'],
  [
    'connect-delivery',
    'disconnect-delivery',
    'rebind',
    'rename',
    'restart-worker',
    'connect-delivery',
    'flush',
    'refresh',
  ],
]
for (const owned of [false, true]) {
  for (const adapter of ['local', 'remote', 'web', 'raw', 'raw-remote', 'raw-web'] as Adapter[]) {
    it.each(histories.map((actions, history) => ({ actions, history })))(
      `delivers owned=${owned} adapter=${adapter} history=$history`,
      async ({ actions }) => {
        const client = new Client(owned, adapter, 'committed')
        try {
          for (const action of actions) {
            await client.step(action)
          }
          await client.settle()
          client.check(true)
        } finally {
          await client.close()
        }
      },
    )
  }
}
