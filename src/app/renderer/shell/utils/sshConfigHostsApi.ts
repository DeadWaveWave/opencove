import type { SshConfigHost } from '@shared/contracts/dto'

export async function loadSshConfigHosts(): Promise<SshConfigHost[]> {
  return await window.opencoveApi.controlSurface.invoke<SshConfigHost[]>({
    kind: 'query',
    id: 'endpoint.sshConfigHosts',
    payload: null,
  })
}
