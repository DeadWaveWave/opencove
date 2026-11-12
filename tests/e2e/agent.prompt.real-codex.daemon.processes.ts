export interface ProcessRow {
  pid: number
  ppid: number
  pgid: number
  /** Linux/macOS ps sess identity; opaque so hexadecimal macOS output stays intact. */
  sid: string | null
  command: string
}

export function parseProcessRows(stdout: string, withSession: boolean): ProcessRow[] {
  return stdout
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const match = (
        withSession
          ? /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u
          : /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u
      ).exec(line)
      if (!match) {
        throw new Error('Unexpected ps row; cannot verify process cleanup')
      }
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        sid: withSession && !/^(?:0x)?0+$|^-$/iu.test(match[4]) ? match[4] : null,
        command: match[withSession ? 5 : 4],
      }
    })
}

export function collectProcessTree(rows: ProcessRow[], rootPid: number): ProcessRow[] {
  const pids = new Set([rootPid])
  let added = true
  while (added) {
    added = false
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid)
        added = true
      }
    }
  }
  return rows.filter(row => pids.has(row.pid))
}

export function createProcessOwnership(snapshot: {
  agentTree: ProcessRow[]
  daemonTree: ProcessRow[]
  daemonPid: number
}) {
  return {
    daemonPid: snapshot.daemonPid,
    daemonPids: new Set(snapshot.daemonTree.map(row => row.pid)),
    agentPids: new Set(snapshot.agentTree.map(row => row.pid)),
    agentGroups: new Set(snapshot.agentTree.map(row => row.pgid).filter(group => group > 0)),
    agentSessions: new Set(snapshot.agentTree.flatMap(row => (row.sid ? [row.sid] : []))),
  }
}

export function classifyRemainingAgentProcesses(
  rows: ProcessRow[],
  ownership: ReturnType<typeof createProcessOwnership>,
): ProcessRow[] {
  for (const row of collectProcessTree(rows, ownership.daemonPid)) {
    ownership.daemonPids.add(row.pid)
  }
  let added = true
  while (added) {
    added = false
    for (const row of rows) {
      if (ownership.agentPids.has(row.pid) || ownership.daemonPids.has(row.pid)) {
        continue
      }
      if (
        ownership.agentPids.has(row.ppid) ||
        ownership.agentGroups.has(row.pgid) ||
        (row.sid !== null && ownership.agentSessions.has(row.sid))
      ) {
        ownership.agentPids.add(row.pid)
        if (row.pgid > 0) {
          ownership.agentGroups.add(row.pgid)
        }
        if (row.sid) {
          ownership.agentSessions.add(row.sid)
        }
        added = true
      }
    }
  }
  return rows.filter(row => ownership.agentPids.has(row.pid))
}
