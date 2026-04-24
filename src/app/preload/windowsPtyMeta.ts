export function resolveWindowsPtyMeta(): { backend: 'conpty'; buildNumber: number } | null {
  if (process.platform !== 'win32') {
    return null
  }

  const systemVersion =
    typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''
  const build = Number.parseInt(systemVersion.split('.')[2] ?? '', 10)
  if (!Number.isFinite(build) || build <= 0) {
    return null
  }

  return {
    backend: 'conpty',
    buildNumber: build,
  }
}
