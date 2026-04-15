import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'

const execFileAsync = promisify(execFile)

export async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

export async function createRepo(repoDir: string): Promise<string> {
  await mkdir(repoDir, { recursive: true })
  await runGit(['init'], repoDir)
  await runGit(['config', 'user.email', 'legacy@example.com'], repoDir)
  await runGit(['config', 'user.name', 'OpenCove Legacy'], repoDir)
  await runGit(['config', 'core.autocrlf', 'false'], repoDir)
  await runGit(['config', 'core.safecrlf', 'false'], repoDir)
  await writeFile(path.join(repoDir, 'README.md'), '# legacy\n', 'utf8')
  await runGit(['add', '.'], repoDir)
  await runGit(['commit', '-m', 'init'], repoDir)
  return repoDir
}

export async function resetWorkspaceState(window: Page, state: unknown): Promise<void> {
  const result = await window.evaluate(async rawState => {
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify(rawState),
    })
  }, state)

  if (!result.ok) {
    throw new Error(
      `Failed to write workspace state: ${result.reason}: ${result.error.code}${
        result.error.debugMessage ? `: ${result.error.debugMessage}` : ''
      }`,
    )
  }
}
