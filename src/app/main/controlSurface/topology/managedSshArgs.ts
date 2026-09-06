import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'

function destination(access: ManagedSshEndpointRuntimeAccess): string {
  const username = access.ssh.username?.trim()
  return username ? `${username}@${access.ssh.host}` : access.ssh.host
}

function options(access: ManagedSshEndpointRuntimeAccess): string[] {
  return [
    ...(access.ssh.port ? ['-p', String(access.ssh.port)] : []),
    ...(access.ssh.host.trim().toLowerCase() === 'localhost' ? ['-o', 'AddressFamily=inet'] : []),
  ]
}

export function buildSshArgs(access: ManagedSshEndpointRuntimeAccess, command: string[]): string[] {
  return [...options(access), destination(access), ...command]
}

export function buildSshTunnelArgs(
  access: ManagedSshEndpointRuntimeAccess,
  tunnel: string[],
): string[] {
  return [...options(access), ...tunnel, destination(access)]
}
