import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { createAgentLaunchArtifactRoot } from '../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import type { AgentLaunchArtifactRoot } from '../../src/contexts/agent/infrastructure/providers/shared/AgentLaunchArtifactFile'

const profiles = new Set<string>()
afterAll(async () => {
  await Promise.all([...profiles].map(path => rm(path, { recursive: true, force: true })))
  profiles.clear()
})

export function createTestAgentLaunchArtifactRoot(): AgentLaunchArtifactRoot {
  const profile = mkdtempSync(join(process.cwd(), 'node_modules', 'agent-launch-test-'))
  profiles.add(profile)
  return createAgentLaunchArtifactRoot(profile)
}
