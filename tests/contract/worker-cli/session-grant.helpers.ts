import { expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runCommand } from '../../../src/platform/process/runCommand'
import { projectId, spaceId, worktreeSpace } from '../../support/cliSessionGrant'
import type { WorkerFixture } from './fixture'

export async function prepareGrantWorker(root: string) {
  const script = join(root, 'granted-provider.mjs')
  await writeFile(
    script,
    `import { writeFile } from 'node:fs/promises'
const names = ['OPENCOVE_CONTROL_URL', 'OPENCOVE_CONTROL_TOKEN', 'OPENCOVE_NODE_ID',
  'OPENCOVE_SESSION_ID', 'OPENCOVE_PROJECT_ID', 'OPENCOVE_SPACE_ID', 'OPENCOVE_ENV']
const grant = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]))
await writeFile(${JSON.stringify(root)} + '/' + process.env.OPENCOVE_NODE_ID + '.grant.json', JSON.stringify(grant), { mode: 0o600 })
await import(${JSON.stringify(pathToFileURL(resolve('scripts/test-agent-session-stub.mjs')).href)})
`,
  )
  return {
    OPENCOVE_TEST_AGENT_STUB_SCRIPT: script,
    OPENCOVE_TEST_PROMPT_RECORD: join(root, 'prompt-record.jsonl'),
    OPENCOVE_TEST_PROMPT_DIALOG: join(root, 'dialog'),
  }
}

export async function seedGrantWorkspace(worker: WorkerFixture) {
  const git = promisify(execFile)
  await git('git', ['init', '-b', 'main', worker.workspace])
  await writeFile(join(worker.workspace, 'README.md'), 'Grant fixture\n')
  await git('git', ['-C', worker.workspace, 'add', 'README.md'])
  await git('git', [
    '-C',
    worker.workspace,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'Initial fixture',
  ])
  await worker.seed(
    projectId,
    [],
    [
      {
        id: spaceId,
        name: 'Main',
        directoryPath: worker.workspace,
        nodeIds: [],
        rect: { x: 0, y: 0, width: 1600, height: 1000 },
      },
      {
        id: worktreeSpace,
        name: 'Worktree',
        directoryPath: worker.workspace,
        nodeIds: [],
        rect: { x: 1800, y: 0, width: 800, height: 600 },
      },
    ],
    { defaultProvider: 'claude-code', agentFullAccess: false },
  )
}

export async function runtimeFootprint(worker: WorkerFixture) {
  const nodes = await worker.invoke<{ nodes: { id: string }[] }>(
    'node.list',
    { projectId },
    'query',
  )
  const sessions = await worker.invoke<{ sessions: { sessionId: string }[] }>(
    'session.list',
    null,
    'query',
  )
  return {
    nodes: nodes.nodes.map(node => node.id).toSorted(),
    sessions: sessions.sessions.map(session => session.sessionId).toSorted(),
  }
}

function providerCli(worker: WorkerFixture, grant: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('OPENCOVE_')),
  )
  return runCommand(
    process.execPath,
    [resolve('out/cli/opencove.mjs'), 'whoami'],
    worker.workspace,
    {
      env: { ...env, ...grant },
      timeoutMs: 15_000,
      captureMaxBytes: 1024 * 1024,
    },
  )
}

export async function assertLiveProviderGrant(
  worker: WorkerFixture,
  nodeId: string,
  sessionId: string,
) {
  const grant = JSON.parse(
    await readFile(join(worker.root, nodeId + '.grant.json'), 'utf8'),
  ) as Record<string, string>
  expect(grant.OPENCOVE_CONTROL_TOKEN).toBeTruthy()
  const live = await providerCli(worker, grant)
  expect(live.exitCode, live.stderr).toBe(0)
  expect(JSON.parse(live.stdout)).toMatchObject({ caller: 'session-grant', nodeId, sessionId })
  return grant
}

export async function assertRevokedProviderGrant(
  worker: WorkerFixture,
  grant: Record<string, string>,
) {
  const revoked = await providerCli(worker, grant)
  expect(revoked.exitCode).toBe(4)
  expect(revoked.stderr).toContain('The control token is invalid or has been revoked.')
}
