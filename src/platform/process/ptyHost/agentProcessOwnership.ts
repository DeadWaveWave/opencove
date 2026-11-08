import { ProcessTreeSnapshot, type ProcessIdentity } from './posixProcessTable'

export function sameProcess(
  expected: ProcessIdentity,
  current: ProcessIdentity | undefined,
): boolean {
  // ps lstart has second resolution: after a full PID wrap, reuse of the same PID
  // within that same second is indistinguishable. This is not identity-bound signalling;
  // there is also a read-to-kill race. No native birth-identity API is used here.
  return current?.pid === expected.pid && current.startTime === expected.startTime
}
const key = (row: ProcessIdentity): string => `${row.pid}:${row.startTime}`
type Ownership = {
  rootPid: number
  root: ProcessIdentity | null
  capturePending: boolean
  exited: boolean
  members: Map<string, ProcessIdentity>
}

/** Lifetime ownership is runtime-only; the root identity is captured once and never rebound. */
export class AgentProcessOwnership {
  private readonly sessions = new Map<string, Ownership>()
  public constructor(private readonly log: (message: string) => void) {}
  public get size(): number {
    return this.sessions.size
  }
  public ids(): string[] {
    return [...this.sessions.keys()]
  }
  public add(id: string, rootPid: number): void {
    if (this.sessions.has(id)) {
      return
    }
    this.sessions.set(id, {
      rootPid,
      root: null,
      capturePending: true,
      exited: false,
      members: new Map(),
    })
  }
  public needsCapture(id: string): boolean {
    return this.sessions.get(id)?.capturePending === true
  }
  public noteExit(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.exited = true
    }
  }
  public remove(id: string): void {
    this.sessions.delete(id)
  }
  public abandonCapture(ids: readonly string[]): void {
    for (const id of ids) {
      const session = this.sessions.get(id)
      if (session) {
        session.capturePending = false
      }
    }
  }
  public observe(
    rows: readonly ProcessIdentity[],
    captureIds: readonly string[],
    complete: boolean,
  ): void {
    const table = new ProcessTreeSnapshot(rows)
    const { byPid } = table
    const eligible = new Set(captureIds)
    for (const [id, session] of this.sessions) {
      if (session.capturePending && eligible.has(id)) {
        session.capturePending = false
        // Accepted first-sample gap: the just-spawned root can exit and its PID
        // can be reused before this async read/exit notification (even within milliseconds).
        // Slow ps extends this gap until the first read; it cannot distinguish that
        // replacement from the launch. A failed first read must never bind later.
        const root = !session.exited ? byPid.get(session.rootPid) : null
        session.root = root ? { ...root } : null
      }
      for (const [identity, member] of session.members) {
        // Missing rows in a partial sample are not evidence of process death.
        if (complete && !sameProcess(member, byPid.get(member.pid))) {
          session.members.delete(identity)
        }
      }
      const descendants = this.discover(id, table)
      // Preserve the root even when the bounded descendant set overflows.
      for (const member of descendants.reverse()) {
        if (session.members.has(key(member))) {
          continue
        }
        if (session.members.size >= 512) {
          this.log(`ownership limit 512 exceeded for session=${id}`)
          break
        }
        session.members.set(key(member), member)
      }
    }
  }
  public verifiedRoot(
    id: string,
    byPid: ReadonlyMap<number, ProcessIdentity>,
  ): ProcessIdentity | null {
    const session = this.sessions.get(id)
    return session?.root && !session.exited && sameProcess(session.root, byPid.get(session.rootPid))
      ? session.root
      : null
  }
  private discover(
    id: string,
    table: ProcessTreeSnapshot,
    retirementMembers: Iterable<ProcessIdentity> = [],
  ): ProcessIdentity[] {
    const session = this.sessions.get(id)
    if (!session) {
      return []
    }
    const seeds = new Set<number>()
    const root = this.verifiedRoot(id, table.byPid)
    if (root) {
      seeds.add(root.pid)
    }
    for (const member of [...session.members.values(), ...retirementMembers]) {
      if (sameProcess(member, table.byPid.get(member.pid))) {
        seeds.add(member.pid)
      }
    }
    return table.descendants(seeds)
  }
  public targets(
    id: string,
    table: ProcessTreeSnapshot,
    retirementMembers: Iterable<ProcessIdentity> = [],
  ): ProcessIdentity[] {
    return this.discover(id, table, retirementMembers)
  }
}
