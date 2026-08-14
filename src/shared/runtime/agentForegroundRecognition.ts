export type RecognizedForegroundAgent = 'codex'

export type ForegroundAgentObservation =
  | {
      availability: 'available'
      agent: RecognizedForegroundAgent | null
      shellOnly: boolean
    }
  | {
      availability: 'unavailable'
      agent: null
      shellOnly: false
    }

export type ForegroundAgentReconciliationSource =
  | 'process_scan'
  | 'windows_exit_code'
  | 'windows_prompt_timeout'

type ForegroundAgentReconciliationIdentity = {
  sessionId: string
  observedAtMs: number
}

export type ForegroundAgentReconciliationEvent = ForegroundAgentReconciliationIdentity &
  (
    | (ForegroundAgentObservation & { source: 'process_scan'; exitCode: null })
    | {
        source: 'windows_exit_code'
        exitCode: number
        availability: 'unavailable'
        agent: null
        shellOnly: false
      }
    | {
        source: 'windows_prompt_timeout'
        exitCode: null
        availability: 'unavailable'
        agent: null
        shellOnly: false
      }
  )

export type ForegroundAgentReconciliationDecision = 'keep' | 'confirm' | 'clear'

interface ProcessRow {
  pid: number
  parentPid: number
  stat: string
  command: string
}

export function recognizeAgentProcessFromCommandLine(
  commandLine: string,
): RecognizedForegroundAgent | null {
  const normalized = commandLine.replaceAll('\\', '/').toLowerCase()
  if (normalized.includes('node_modules/@openai/codex/')) {
    return 'codex'
  }
  const executable = normalized.trim().split(/\s+/u)[0]?.split('/').pop() ?? ''
  return /^codex-[a-z0-9_-]+$/u.test(executable) ? 'codex' : null
}

function parseSnapshot(snapshot: string): ProcessRow[] | null {
  const rows: ProcessRow[] = []
  for (const rawLine of snapshot.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line)
    if (!match) {
      return null
    }
    rows.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      stat: match[3] ?? '',
      command: match[4] ?? '',
    })
  }
  return rows.length > 0 ? rows : null
}

export function resolveForegroundAgentObservation(
  snapshot: string,
  rootPid: number,
): ForegroundAgentObservation {
  const rows = parseSnapshot(snapshot)
  if (!rows || !rows.some(row => row.pid === rootPid)) {
    return { availability: 'unavailable', agent: null, shellOnly: false }
  }
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.parentPid)) {
        descendants.add(row.pid)
        changed = true
      }
    }
  }
  const foreground = rows.filter(row => descendants.has(row.pid) && row.stat.includes('+'))
  for (const row of foreground.sort((left, right) => right.pid - left.pid)) {
    const agent = recognizeAgentProcessFromCommandLine(row.command)
    if (agent) {
      return { availability: 'available', agent, shellOnly: false }
    }
  }
  const rootOwnsForeground = foreground.some(row => row.pid === rootPid)
  return {
    availability: 'available',
    agent: null,
    shellOnly: rootOwnsForeground && foreground.length === 1,
  }
}

export function resolveForegroundAgentReconciliation(
  event: ForegroundAgentReconciliationEvent,
): ForegroundAgentReconciliationDecision {
  // A failed process scan is weak runtime evidence and must never erase a durable overlay.
  // Windows completion fallback is modeled as a separate, bounded fact from the prompt marker.
  if (event.source === 'windows_exit_code' || event.source === 'windows_prompt_timeout') {
    return 'clear'
  }
  if (event.availability === 'unavailable') {
    return 'keep'
  }
  return event.agent === 'codex' ? 'confirm' : 'clear'
}
