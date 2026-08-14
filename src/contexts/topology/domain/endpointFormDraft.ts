export type EndpointRegisterMode = 'managed' | 'manual'

export interface EndpointFormDraft {
  registerMode: EndpointRegisterMode
  displayName: string
  managedHost: string
  managedPort: string
  managedUsername: string
  managedRemotePort: string
  manualHostname: string
  manualPort: string
  manualToken: string
}

export interface ManagedSshDraftSource {
  displayName: string
  host: string
  port: number | null
  username: string | null
  remotePort: number | null
}

export function createEmptyEndpointFormDraft(): EndpointFormDraft {
  return {
    registerMode: 'managed',
    displayName: '',
    managedHost: '',
    managedPort: '',
    managedUsername: '',
    managedRemotePort: '',
    manualHostname: '',
    manualPort: '',
    manualToken: '',
  }
}

export function buildManagedSshDraft(source: ManagedSshDraftSource): EndpointFormDraft {
  return {
    ...createEmptyEndpointFormDraft(),
    displayName: source.displayName,
    managedHost: source.host,
    managedPort: source.port === null ? '' : String(source.port),
    managedUsername: source.username ?? '',
    managedRemotePort: source.remotePort === null ? '' : String(source.remotePort),
  }
}

export function isEndpointFormDirty(
  current: EndpointFormDraft,
  baseline: EndpointFormDraft,
): boolean {
  return (Object.keys(baseline) as Array<keyof EndpointFormDraft>).some(
    field => current[field] !== baseline[field],
  )
}
