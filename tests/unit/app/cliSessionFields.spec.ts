// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture } from './cliIdentity.helpers'

it.each(['run-agent', 'get'])(
  'session %s help advertises only fields supplied by session queries',
  async action => {
    const f = identityFixture(false)
    expect(await run(['session', action, '--help'], f.io)).toBe(0)
    for (const field of ['spawnedBy', 'lineageDepth', 'lineageStatus']) {
      expect(f.out()).not.toContain(field)
    }
    expect(f.out()).toContain('sessionId')
  },
)
it.each([['node', 'get'], ['agent', 'get'], ['context']])(
  'retains lineage fields on %j help',
  async (...path) => {
    const f = identityFixture(false)
    expect(await run([...path, '--help'], f.io)).toBe(0)
    for (const field of ['spawnedBy', 'lineageDepth', 'lineageStatus']) {
      expect(f.out()).toContain(field)
    }
  },
)
