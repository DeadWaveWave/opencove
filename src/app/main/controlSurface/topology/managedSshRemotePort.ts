import { randomInt } from 'node:crypto'

const MANAGED_SSH_REMOTE_PORT_MIN = 40_000
const MANAGED_SSH_REMOTE_PORT_MAX = 60_999

export function allocateManagedSshRemotePort(usedPorts: Iterable<number>): number {
  const used = new Set(usedPorts)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = randomInt(MANAGED_SSH_REMOTE_PORT_MIN, MANAGED_SSH_REMOTE_PORT_MAX + 1)
    if (!used.has(candidate)) {
      return candidate
    }
  }

  return randomInt(MANAGED_SSH_REMOTE_PORT_MIN, MANAGED_SSH_REMOTE_PORT_MAX + 1)
}
