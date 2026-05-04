import { spawnSync } from 'node:child_process'
import process from 'node:process'

export type WindowsProcessTreeKillResult = 'skipped' | 'terminated' | 'not_found' | 'failed'

export interface WindowsProcessTreeKiller {
  kill: (pid: number) => { status: number | null; error?: unknown }
}

const TASKKILL_PROCESS_NOT_FOUND_EXIT_CODE = 128

function normalizePid(pid: number | null | undefined): number | null {
  if (!Number.isFinite(pid) || !pid || pid <= 0) {
    return null
  }

  return Math.floor(pid)
}

const defaultKiller: WindowsProcessTreeKiller = {
  kill: pid =>
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5_000,
    }),
}

export function killWindowsProcessTree(
  pid: number | null | undefined,
  options: {
    platform?: NodeJS.Platform
    killer?: WindowsProcessTreeKiller
  } = {},
): WindowsProcessTreeKillResult {
  if ((options.platform ?? process.platform) !== 'win32') {
    return 'skipped'
  }

  const normalizedPid = normalizePid(pid)
  if (!normalizedPid) {
    return 'skipped'
  }

  const result = (options.killer ?? defaultKiller).kill(normalizedPid)
  if (result.error) {
    return 'failed'
  }

  if (result.status === 0) {
    return 'terminated'
  }

  if (result.status === TASKKILL_PROCESS_NOT_FOUND_EXIT_CODE) {
    return 'not_found'
  }

  return 'failed'
}
