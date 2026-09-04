import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

function readJob(workflow: string, jobName: string, nextJobName: string): string {
  const start = workflow.indexOf(`  ${jobName}:`)
  const end = workflow.indexOf(`  ${nextJobName}:`, start + 1)
  if (start < 0 || end < 0) {
    throw new Error(`Missing CI job boundary for ${jobName}`)
  }
  return workflow.slice(start, end)
}

describe('CI E2E browser provisioning', () => {
  it('installs Chromium before Desktop/Web continuity tests on Linux and macOS', async () => {
    const workflow = await readFile(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8')
    const jobs = [
      readJob(workflow, 'e2e-ubuntu', 'web-canvas-continuity-ubuntu'),
      readJob(workflow, 'ci-macos', 'platform-e2e-windows'),
    ]

    for (const job of jobs) {
      const installAt = job.indexOf('Install Chromium for Desktop/Web continuity E2E')
      const testAt = job.indexOf('E2E tests (shard)')
      expect(installAt).toBeGreaterThanOrEqual(0)
      expect(job).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: ''")
      expect(job).toContain('pnpm exec playwright install')
      expect(installAt).toBeLessThan(testAt)
    }
  })
})
