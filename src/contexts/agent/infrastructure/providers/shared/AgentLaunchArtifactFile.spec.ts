import { expect, it } from 'vitest'
import { createAgentLaunchArtifactFile } from './AgentLaunchArtifactFile'

// Compiled by pnpm check: neither the old signature nor an arbitrary path is a launch root.
it('requires a user-data launch root at the file boundary', () => {
  const legacyCall = () => {
    // @ts-expect-error -- the launch artifact root is required
    return createAgentLaunchArtifactFile('prefix-', 'settings.json', '{}')
  }
  const unbrandedCall = () => {
    // @ts-expect-error -- only the composition root can supply the branded user-data path
    return createAgentLaunchArtifactFile('/tmp', 'prefix-', 'settings.json', '{}')
  }
  expect(legacyCall).toBeTypeOf('function')
  expect(unbrandedCall).toBeTypeOf('function')
})
