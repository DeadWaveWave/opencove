type OzonePlatform = 'wayland' | 'x11'

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function normalizeOzonePlatform(rawValue: string | undefined): OzonePlatform | null {
  if (!rawValue) {
    return null
  }

  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'wayland' || normalized === 'x11') {
    return normalized
  }

  return null
}

function resolveCliOzonePlatform(argv: string[]): OzonePlatform | null {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const argument = argv[index]?.trim()
    if (!argument) {
      continue
    }

    if (argument.startsWith('--ozone-platform=')) {
      return normalizeOzonePlatform(argument.slice('--ozone-platform='.length))
    }

    if (argument === '--ozone-platform') {
      return normalizeOzonePlatform(argv[index + 1])
    }
  }

  return null
}

export function shouldEnableWaylandIme({
  argv = process.argv,
  env,
  platform,
}: {
  argv?: string[]
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}): boolean {
  if (platform !== 'linux') {
    return false
  }

  const explicitOzonePlatform =
    resolveCliOzonePlatform(argv) ?? normalizeOzonePlatform(env['ELECTRON_OZONE_PLATFORM_HINT'])

  if (explicitOzonePlatform === 'x11') {
    return false
  }

  if (explicitOzonePlatform === 'wayland') {
    return true
  }

  if (isTruthyEnv(env['NIXOS_OZONE_WL'])) {
    return true
  }

  const sessionType = env['XDG_SESSION_TYPE']?.trim().toLowerCase()
  if (sessionType === 'x11') {
    return false
  }

  if (sessionType === 'wayland') {
    return true
  }

  return (env['WAYLAND_DISPLAY'] ?? '').trim().length > 0
}
