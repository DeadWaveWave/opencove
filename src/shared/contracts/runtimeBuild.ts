/** Shared source identity; a platform archive has a separate SHA256 digest. */
export interface RuntimeBuildIdentity {
  schemaVersion: 1
  buildId: string
  appVersion: string
  channel: 'stable' | 'nightly' | 'dev'
  protocolVersion: number
  ptyProtocolVersion: number
  launchContractVersion: number
  dataSchemaVersion: number
}

export function parseRuntimeBuildIdentity(value: unknown): RuntimeBuildIdentity | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.buildId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.buildId) ||
    typeof record.appVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(record.appVersion) ||
    !['stable', 'nightly', 'dev'].includes(String(record.channel)) ||
    !['protocolVersion', 'ptyProtocolVersion', 'launchContractVersion', 'dataSchemaVersion'].every(
      key =>
        typeof record[key] === 'number' && Number.isSafeInteger(record[key]) && record[key] > 0,
    )
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    buildId: record.buildId,
    appVersion: record.appVersion,
    channel: record.channel as RuntimeBuildIdentity['channel'],
    protocolVersion: record.protocolVersion as number,
    ptyProtocolVersion: record.ptyProtocolVersion as number,
    launchContractVersion: record.launchContractVersion as number,
    dataSchemaVersion: record.dataSchemaVersion as number,
  }
}

/** Actual advertised transports must agree with the embedded compatibility descriptor. */
export function hasManagedRuntimeCapabilities(
  value: Record<string, unknown>,
  build: RuntimeBuildIdentity,
): boolean {
  const features = value.features as Record<string, unknown> | undefined
  const streaming = features?.sessionStreaming as Record<string, unknown> | undefined
  const sync = features?.sync as Record<string, unknown> | undefined
  return (
    value.protocolVersion === build.protocolVersion &&
    streaming?.enabled === true &&
    streaming.ptyProtocolVersion === build.ptyProtocolVersion &&
    sync?.state === true &&
    sync.events === true
  )
}
