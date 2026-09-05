import type { RuntimeBuildIdentity } from '../../src/shared/contracts/runtimeBuild'

export const runtimeBuildFixture: RuntimeBuildIdentity = {
  schemaVersion: 1,
  buildId: 'a'.repeat(64),
  appVersion: '0.3.1',
  channel: 'stable',
  protocolVersion: 2,
  ptyProtocolVersion: 1,
  launchContractVersion: 1,
  dataSchemaVersion: 13,
}
