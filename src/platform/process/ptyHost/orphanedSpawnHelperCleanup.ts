import { spawnSync } from 'node:child_process'
import process from 'node:process'

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function cleanupOrphanedNodePtySpawnHelpers(): void {
  if (process.platform === 'win32') {
    return
  }

  const spawnHelperMarker = '/node-pty/build/Release/spawn-helper'
  const psResult = spawnSync('ps', ['ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    env: process.env,
  })

  if (psResult.status !== 0 || typeof psResult.stdout !== 'string') {
    return
  }

  const candidates: number[] = []
  for (const line of psResult.stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) {
      continue
    }

    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3] ?? ''
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid || ppid !== 1) {
      continue
    }

    if (!command.replaceAll('\\', '/').includes(spawnHelperMarker)) {
      continue
    }
    candidates.push(pid)
  }

  for (const pid of candidates) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Ignore an already-exited helper.
    }
  }

  for (const pid of candidates) {
    if (!isProcessAlive(pid)) {
      continue
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Ignore an already-exited helper.
    }
  }
}
