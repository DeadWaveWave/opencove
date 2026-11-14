import { it } from 'vitest'
import { Client } from '../../support/convergence/client'
import { explore } from '../../support/convergence/model'
import { value } from '../../support/convergence/fixture'
import { legacyBaseline } from '../../support/convergence/legacyBaseline'
import { checkLegacyCompatibility } from '../../support/convergence/legacy'
import type { Adapter } from '../../support/convergence/server'
it.each(legacyBaseline)('matches legacy $adapter:$index', async row => {
  const trace = explore()[row.index],
    client = new Client(false, row.adapter as Adapter, trace.response)
  // I1–I6 are checked by the model suite; this independent differential check isolates I7.
  client.check = () => {}
  try {
    for (const action of trace.actions) {
      await client.step(action)
    }
    await client.quiet()
    checkLegacyCompatibility(row, { ui: value(client.state()), server: client.server.model.value })
  } finally {
    await client.close()
  }
})
