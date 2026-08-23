import { TerminalRuntimeAvailability } from '../../../src/contexts/terminal/application/TerminalRuntimeAvailability'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'

export function createReadyTerminalAdmissionDeps(): {
  terminalSpawnAdmission: TerminalRuntimeAvailability
  terminalRecoverySpawnAdmission: TerminalRuntimeAvailability
} {
  const availability = new TerminalRuntimeAvailability()
  availability.completeStartup([])
  return {
    terminalSpawnAdmission: availability,
    terminalRecoverySpawnAdmission: availability,
  }
}

export function createTestAgentProviderRegistry(): AgentProviderRegistry {
  return new AgentProviderRegistry(createBuiltinAgentProviderContributions())
}
