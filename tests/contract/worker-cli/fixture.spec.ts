import { expect, test } from '@playwright/test'
import { withWorker } from './fixture'
import { jsonOutput, terminalCommand } from './terminal'

test('isolated Worker gives a real PTY the built CLI and a genuine scoped grant', async () => {
  await withWorker(async worker => {
    await worker.seed('fixture-project')
    const shell = await worker.createTerminal('fixture-project')
    const identity = jsonOutput(await terminalCommand(worker, shell, 'opencove whoami', 'IDENTITY'))
    expect(identity).toMatchObject({
      caller: 'session-grant',
      projectId: 'fixture-project',
      nodeId: shell.nodeId,
      sessionId: shell.sessionId,
    })
    const sessions = await worker.invoke<{ sessions: { sessionId: string; status: string }[] }>(
      'session.list',
      null,
      'query',
    )
    expect(sessions.sessions).toContainEqual(
      expect.objectContaining({ sessionId: shell.sessionId, status: 'running' }),
    )
  })
})
