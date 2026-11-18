import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')
const ubuntuInstallAction = './.github/actions/install-playwright-browsers'

function readJob(workflow: string, jobName: string, nextJobName: string): string {
  const start = workflow.indexOf(`  ${jobName}:`)
  const end = workflow.indexOf(`  ${nextJobName}:`, start + 1)
  if (start < 0 || end < 0) {
    throw new Error(`Missing CI job boundary for ${jobName}`)
  }
  return workflow.slice(start, end)
}

function readStep(job: string, stepName: string): string {
  const start = job.indexOf(`- name: ${stepName}`)
  if (start < 0) {
    throw new Error(`Missing CI step ${stepName}`)
  }
  const next = job.indexOf('\n      - name: ', start + 1)
  return job.slice(start, next < 0 ? undefined : next)
}

async function readWorkflow(): Promise<string> {
  return await readFile(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8')
}

describe('CI E2E browser provisioning', () => {
  it('installs the browsers through the cached Ubuntu action, bounded, before the Ubuntu tests', async () => {
    const workflow = await readWorkflow()
    const cases = [
      {
        job: readJob(workflow, 'e2e-ubuntu', 'web-canvas-continuity-ubuntu'),
        install: 'Install Chromium for Desktop/Web continuity E2E',
        browsers: 'chromium',
        firstTest: 'E2E tests (shard)',
      },
      {
        job: readJob(workflow, 'web-canvas-continuity-ubuntu', 'macos-platform'),
        install: 'Install Web Canvas browsers',
        browsers: 'chromium webkit',
        firstTest: 'Web canvas tests (chromium)',
      },
    ]

    for (const { job, install, browsers, firstTest } of cases) {
      const step = readStep(job, install)
      expect(step).toContain(`uses: ${ubuntuInstallAction}`)
      expect(step).toContain(`browsers: ${browsers}\n`)
      expect(step).toMatch(/timeout-minutes: \d+/)
      expect(job.indexOf(install)).toBeLessThan(job.indexOf(firstTest))
      // Every Ubuntu browser install goes through the action, so none fetches packages uncached.
      expect(job).not.toContain('pnpm exec playwright install')
    }
  })

  it('installs Chromium directly on macOS, where there are no apt packages', async () => {
    const workflow = await readWorkflow()
    const job = readJob(workflow, 'ci-macos', 'platform-e2e-windows')
    const step = readStep(job, 'Install Chromium for Desktop/Web continuity E2E')

    expect(step).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: ''")
    expect(step).toContain('pnpm exec playwright install chromium')
    expect(job.indexOf('Install Chromium for Desktop/Web continuity E2E')).toBeLessThan(
      job.indexOf('E2E tests (shard)'),
    )
  })

  it('caches only verified package files and installs with the browser download enabled', async () => {
    const action = await readFile(
      resolve(rootDir, '.github/actions/install-playwright-browsers/action.yml'),
      'utf8',
    )
    const restoreAt = action.indexOf('uses: actions/cache/restore@')
    const verifyAt = action.indexOf(
      'bash "$GITHUB_ACTION_PATH/drop-unverified-packages.sh" /var/cache/apt/archives',
    )
    const installAt = action.indexOf('pnpm exec playwright install --with-deps $BROWSERS')
    const saveAt = action.indexOf('uses: actions/cache/save@')

    // Restore, then verify against the index, then install, then save: the order is the contract.
    expect(restoreAt).toBeGreaterThanOrEqual(0)
    expect(restoreAt).toBeLessThan(verifyAt)
    expect(verifyAt).toBeLessThan(installAt)
    expect(installAt).toBeLessThan(saveAt)
    expect(action.slice(restoreAt, verifyAt)).toContain('sudo apt-get update')

    // Restore and save the same files: apt's .deb archives, never its lock file or partial downloads.
    const cachedPaths = [...action.matchAll(/^\s+path: (.+)$/gm)].map(match => match[1])
    expect(cachedPaths).toEqual(['/var/cache/apt/archives/*.deb', '/var/cache/apt/archives/*.deb'])

    expect(action.slice(installAt - 400, installAt)).toContain(
      "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: ''",
    )
    expect(action.slice(saveAt - 200, saveAt)).toContain(
      "steps.restore.outputs.cache-hit != 'true'",
    )
  })
})
