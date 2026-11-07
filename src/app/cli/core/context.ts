import path from 'node:path'
import type { CliIo } from './io'
import { CliError, usage } from './errors'
export interface Connection {
  endpoint: string
  token: string
}
export async function resolveConnection(
  options: Record<string, unknown>,
  io: CliIo,
): Promise<Connection> {
  const endpoint = options.endpoint ?? io.env.OPENCOVE_CONTROL_URL
  const token = options.token ?? io.env.OPENCOVE_CONTROL_TOKEN
  if (endpoint !== undefined) {
    if (!token) {
      usage('Missing connection token', 'Use --token <token>')
    }
    let url: URL
    try {
      url = new URL(String(endpoint).includes('://') ? String(endpoint) : `http://${endpoint}`)
    } catch {
      usage('Invalid endpoint')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      usage('Endpoint must use HTTP or HTTPS')
    }
    return { endpoint: url.origin, token: String(token) }
  }
  const explicit = options['user-data'] ?? io.env.OPENCOVE_USER_DATA_DIR
  const profiles = explicit !== undefined ? [String(explicit)] : (io.profileCandidates?.() ?? [])
  const candidates: (Connection & {
    userData: string
    pid: number
    startedBy: string
    port: number
  })[] = []
  await Promise.all(
    profiles.flatMap(userData =>
      ['control-surface.json', 'worker-control-surface.json'].map(async name => {
        try {
          const value = JSON.parse(await io.readTextFile(path.join(userData, name)))
          if (
            value.version !== 1 ||
            typeof value.hostname !== 'string' ||
            !value.hostname ||
            typeof value.token !== 'string' ||
            !value.token ||
            !Number.isInteger(value.port) ||
            value.port <= 0 ||
            value.port > 65535 ||
            !Number.isInteger(value.pid) ||
            value.pid <= 0 ||
            !Number.isFinite(Date.parse(value.createdAt)) ||
            !io.isProcessAlive?.(value.pid)
          ) {
            return
          }
          candidates.push({
            endpoint: `http://${value.hostname}:${value.port}`,
            token: String(token ?? value.token),
            userData,
            pid: value.pid,
            startedBy: value.startedBy ?? 'unknown',
            port: value.port,
          })
        } catch {
          /* Missing, invalid and stale connection files are not live candidates. */
        }
      }),
    ),
  )
  if (candidates.length > 1) {
    throw new CliError(
      'context.ambiguous',
      6,
      'Multiple live control surfaces found',
      'Use --user-data <dir>',
      candidates.map(({ userData, pid, startedBy, port }) => ({ userData, pid, startedBy, port })),
    )
  }
  if (!candidates.length) {
    throw new CliError(
      'context.unreachable',
      3,
      'OpenCove is not running for this profile.',
      'Start the OpenCove app, or run "opencove worker start". Use --user-data <dir> to target another profile.',
      { profiles },
    )
  }
  return candidates[0]
}
