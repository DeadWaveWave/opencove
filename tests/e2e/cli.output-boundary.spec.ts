import { test } from '@playwright/test'
import { createOutputTerminal, withOutputWorkspace } from './cli.output.helpers'

// Keep the original helper's canvas focus and aria-busy assertions on Desktop.
// The list/read matrices run through real PTYs in tests/contract/worker-cli.
test('projects the CLI coordinator, output terminal and agent as ready canvas terminals', async () => {
  await withOutputWorkspace([], async page => {
    await createOutputTerminal(page)
    await createOutputTerminal(page, 'agent')
  })
})
