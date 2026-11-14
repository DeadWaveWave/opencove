import { it } from 'vitest'
import { Client } from '../../support/convergence/client'
import { explore } from '../../support/convergence/model'
import type { Adapter } from '../../support/convergence/server'
for (const owned of [false, true]) {
  for (const adapter of ['local', 'remote', 'web', 'raw', 'raw-remote', 'raw-web'] as Adapter[]) {
    it.each(explore().map((trace, index) => ({ ...trace, index })))(
      'converges owned=' + owned + ' adapter=' + adapter + ' trace=$index response=$response',
      async ({ response, actions }) => {
        const client = new Client(owned, adapter, response)
        try {
          for (const action of actions) {
            await client.step(action)
          }
          await client.quiet()
        } catch (error) {
          throw new Error(`Trace ${actions.join(' → ')}: ${String(error)}`, { cause: error })
        } finally {
          await client.close()
        }
      },
    )
  }
}
