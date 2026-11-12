import { describe, expect, it } from 'vitest'
import {
  createProcessOwnership,
  classifyRemainingAgentProcesses,
  parseProcessRows,
  type ProcessRow,
} from '../../e2e/agent.prompt.real-codex.daemon.processes'
import { AcceptanceFailures } from '../../e2e/agent.prompt.real-codex.daemon.failures'

const row = (
  pid: number,
  ppid: number,
  pgid: number,
  sid: string | null,
  command = 'codex app-server',
): ProcessRow => ({ pid, ppid, pgid, sid, command })
const snapshot = () => ({
  daemonPid: 20,
  agentTree: [row(10, 2, 10, '10'), row(11, 10, 11, '10', 'sleep 30')],
  daemonTree: [row(20, 1, 20, '20')],
})

describe('Codex daemon process ownership', () => {
  it('catches a new reparented git child in a recorded group without matching argv paths', () => {
    const orphan = row(12, 1, 11, '12', 'git status --porcelain')
    expect(classifyRemainingAgentProcesses([orphan], createProcessOwnership(snapshot()))).toEqual([
      orphan,
    ])
  })
  it('catches a reparented app-server in another group of the recorded session', () => {
    const orphan = row(13, 1, 99, '10')
    expect(classifyRemainingAgentProcesses([orphan], createProcessOwnership(snapshot()))).toEqual([
      orphan,
    ])
  })
  it('retains a recorded live git child by PID when it detaches into another group and session', () => {
    const git = row(14, 10, 14, '10', 'git fetch')
    const before = snapshot()
    const ownership = createProcessOwnership({ ...before, agentTree: [...before.agentTree, git] })
    const detached = { ...git, ppid: 1, pgid: 45, sid: '45' }
    expect(classifyRemainingAgentProcesses([detached], ownership)).toEqual([detached])
  })
  it('ignores an unrelated process whose argv includes the workspace and CODEX_HOME', () => {
    expect(
      classifyRemainingAgentProcesses(
        [row(50, 1, 50, '50', 'tail -f /tmp/codex-home/.tmp/plugins /tmp/workspace/README.md')],
        createProcessOwnership(snapshot()),
      ),
    ).toEqual([])
  })
  it('retains newly observed descendants after they change group/session and are reparented', () => {
    const ownership = createProcessOwnership(snapshot())
    classifyRemainingAgentProcesses([row(10, 2, 10, '10'), row(14, 10, 14, '14')], ownership)
    const orphan = row(14, 1, 15, '15')
    expect(classifyRemainingAgentProcesses([orphan], ownership)).toEqual([orphan])
  })
  it('excludes daemon descendants even when their groups overlap, including newly observed ones', () => {
    const rows = [row(20, 1, 20, '20'), row(21, 20, 11, '10', 'git fetch')]
    expect(classifyRemainingAgentProcesses(rows, createProcessOwnership(snapshot()))).toEqual([])
  })
  it('does not interpret missing session identities or group zero as ownership', () => {
    expect(
      classifyRemainingAgentProcesses(
        [row(30, 1, 0, null)],
        createProcessOwnership({ daemonPid: 20, daemonTree: [], agentTree: [row(10, 2, 0, null)] }),
      ),
    ).toEqual([])
  })
  it.each(['123', 'aabbccdd'])('parses the OS session token %s without interpreting argv', sid => {
    expect(parseProcessRows(`10 2 10 ${sid} git status --porcelain`, true)).toEqual([
      row(10, 2, 10, sid, 'git status --porcelain'),
    ])
  })
})

describe('Codex acceptance error preservation', () => {
  it('keeps the primary error first and still attempts every cleanup', async () => {
    const errors = new AcceptanceFailures()
    const primary = new Error('process leak')
    const secondary = new Error('daemon unhealthy')
    const attempted: string[] = []
    await errors.capture('acceptance', async () => {
      throw primary
    })
    await errors.capture('daemon health', async () => {
      throw secondary
    })
    await errors.capture('app teardown', async () => {
      attempted.push('closed')
    })
    let caught: unknown
    try {
      errors.throwIfAny()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([primary, secondary])
    expect((caught as AggregateError).errors[0]).toBe(primary)
    expect((caught as AggregateError).errors[1]).toBe(secondary)
    expect(attempted).toEqual(['closed'])
  })
  it('rethrows a sole failure unchanged', async () => {
    const errors = new AcceptanceFailures()
    const primary = new Error('first')
    await errors.capture('acceptance', async () => {
      throw primary
    })
    expect(() => errors.throwIfAny()).toThrow(primary)
  })
})
