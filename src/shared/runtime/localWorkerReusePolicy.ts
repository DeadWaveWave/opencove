import type { WorkerConnectionInfoDto } from '../contracts/dto'

export type LocalWorkerLauncherOwner = 'cli' | 'desktop'

export type LocalWorkerReusePolicy =
  | {
      canReuse: true
      expectedAppVersion: string | null
    }
  | {
      canReuse: false
    }

function normalizeAppVersion(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function resolveLocalWorkerReusePolicy(
  connection: Pick<WorkerConnectionInfoDto, 'appVersion' | 'startedBy'>,
  options: {
    launcherStartedBy?: LocalWorkerLauncherOwner
    desktopAppVersion?: string | null
  } = {},
): LocalWorkerReusePolicy {
  const launcherStartedBy = options.launcherStartedBy ?? 'desktop'
  if (launcherStartedBy !== 'desktop') {
    return { canReuse: true, expectedAppVersion: null }
  }

  if (connection.startedBy === 'cli') {
    return { canReuse: true, expectedAppVersion: null }
  }

  if (connection.startedBy !== 'desktop') {
    return { canReuse: false }
  }

  const desktopAppVersion = normalizeAppVersion(options.desktopAppVersion)
  if (!desktopAppVersion) {
    return { canReuse: false }
  }

  if (normalizeAppVersion(connection.appVersion) !== desktopAppVersion) {
    return { canReuse: false }
  }

  return { canReuse: true, expectedAppVersion: desktopAppVersion }
}
