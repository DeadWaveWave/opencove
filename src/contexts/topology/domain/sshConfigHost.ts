import type { SshConfigHost } from '../../../shared/contracts/dto'

export function normalizeSshConfigAlias(alias: string): string {
  return alias.trim().toLowerCase()
}

export function uniqueImportableSshConfigHosts(hosts: readonly SshConfigHost[]): SshConfigHost[] {
  const seenAliases = new Set<string>()
  return hosts.filter(host => {
    const normalizedAlias = normalizeSshConfigAlias(host.alias)
    if (normalizedAlias.length === 0 || seenAliases.has(normalizedAlias)) {
      return false
    }
    seenAliases.add(normalizedAlias)
    return true
  })
}
