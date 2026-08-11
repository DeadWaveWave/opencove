import { TerminalRuntimeAvailability } from '../../../src/contexts/terminal/application/TerminalRuntimeAvailability'

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
