// @vitest-environment node
import { expect, it } from 'vitest'
import { commands } from '../../../src/app/cli/commands'

it.each(['prompt', 'wait', 'read'])(
  'agent %s help keeps operational basics and links detailed semantics',
  action => {
    const description = commands.find(c => c.path.join(' ') === `agent ${action}`)!.description!
    expect(description.split(/\s+/).length).toBeLessThan(250)
    expect(description).toContain('opencove skill')
    expect(description).toMatch(/never resend/i)
    expect(description).toContain('Exit codes:')
  },
)
