import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeTranscriptAccess } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptAccess'

const cleanup: (() => Promise<void>)[] = []
export async function disposeFixtures() {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
}
export async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-access-'))
  const config = join(root, 'config'),
    project = join(config, 'projects', 'workspace'),
    path = join(project, 'provider.jsonl')
  await fs.mkdir(project, { recursive: true })
  await fs.writeFile(path, '{}\n')
  cleanup.push(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, config, project, path, access: claudeTranscriptAccess(path, 'provider', [config]) }
}
