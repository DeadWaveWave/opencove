import type { SshConfigHost } from '../../../shared/contracts/dto'

export type SshConfigEndpointDraft = {
  displayName: string
  host: string
  port: null
  username: null
  remotePort: null
  remotePlatform: 'auto'
  isAlreadyAdded: boolean
}

export function parseSshConfig(content: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = []
  let currentHosts: SshConfigHost[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const directive = parseDirective(rawLine)
    if (!directive) {
      continue
    }

    if (directive.key === 'host') {
      appendHosts(hosts, currentHosts)
      currentHosts = splitArguments(directive.value)
        .filter(isConcreteAlias)
        .map(alias => ({ alias, hostName: null, user: null, port: null }))
      continue
    }

    if (directive.key === 'match') {
      appendHosts(hosts, currentHosts)
      currentHosts = []
      continue
    }

    if (currentHosts.length === 0) {
      continue
    }

    const value = splitArguments(directive.value)[0]
    if (value === undefined) {
      continue
    }

    switch (directive.key) {
      case 'hostname':
        setFirstValue(currentHosts, 'hostName', value)
        break
      case 'user':
        setFirstValue(currentHosts, 'user', value)
        break
      case 'port': {
        const port = parsePort(value)
        if (port !== null) {
          setFirstValue(currentHosts, 'port', port)
        }
        break
      }
    }
  }

  appendHosts(hosts, currentHosts)
  return hosts
}

export function sshConfigHostToDraft(
  host: SshConfigHost,
  existingHosts: Iterable<string>,
): SshConfigEndpointDraft {
  const normalizedExistingHosts = new Set(
    Array.from(existingHosts, existingHost => normalizeAlias(existingHost)),
  )

  return {
    displayName: host.alias,
    host: host.alias,
    port: null,
    username: null,
    remotePort: null,
    remotePlatform: 'auto',
    isAlreadyAdded: normalizedExistingHosts.has(normalizeAlias(host.alias)),
  }
}

function parseDirective(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const match = trimmed.match(/^([^=\s]+)(?:\s*=\s*|\s+)(.*)$/)
  if (!match) {
    return null
  }

  return { key: match[1].toLowerCase(), value: match[2].trim() }
}

function splitArguments(input: string): string[] {
  const argumentsList: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const character of input) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (quote && character === '\\') {
      escaped = true
      continue
    }
    if (character === '"' || character === "'") {
      if (quote === character) {
        quote = null
      } else if (quote === null) {
        quote = character
      } else {
        current += character
      }
      continue
    }
    if (quote === null && character === '#') {
      break
    }
    if (quote === null && /\s/.test(character)) {
      if (current) {
        argumentsList.push(current)
        current = ''
      }
      continue
    }
    current += character
  }

  if (current) {
    argumentsList.push(current)
  }
  return argumentsList
}

function isConcreteAlias(alias: string): boolean {
  return !alias.includes('*') && !alias.includes('?') && !alias.includes('!')
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const port = Number(value)
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null
}

function setFirstValue<K extends 'hostName' | 'user' | 'port'>(
  hosts: SshConfigHost[],
  key: K,
  value: SshConfigHost[K],
): void {
  for (const host of hosts) {
    if (host[key] === null) {
      host[key] = value
    }
  }
}

function appendHosts(target: SshConfigHost[], entries: SshConfigHost[]): void {
  for (const entry of entries) {
    target.push(entry)
  }
}

function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase()
}
