import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')
const ubuntuInstallAction = './.github/actions/install-playwright-browsers'
const directInstall = 'pnpm exec playwright install'

function readJob(workflow: string, jobName: string, nextJobName: string): string {
  const start = workflow.indexOf(`  ${jobName}:`)
  const end = workflow.indexOf(`  ${nextJobName}:`, start + 1)
  if (start < 0 || end < 0) {
    throw new Error(`Missing CI job boundary for ${jobName}`)
  }
  return workflow.slice(start, end)
}

/** Splits a list of steps at its `- name:` items, given the indentation of the dash. */
function readSteps(text: string, indent: string): Map<string, string> {
  const marker = `\n${indent}- name: `
  const steps = new Map<string, string>()
  for (const chunk of text.split(marker).slice(1)) {
    const name = chunk.slice(0, chunk.indexOf('\n')).trim()
    steps.set(name, chunk)
  }
  return steps
}

function readStep(steps: Map<string, string>, name: string): string {
  const step = steps.get(name)
  if (step === undefined) {
    throw new Error(`Missing CI step ${name}`)
  }
  return step
}

async function readRepoFile(path: string): Promise<string> {
  return await readFile(resolve(rootDir, path), 'utf8')
}

describe('CI E2E browser provisioning', () => {
  it('installs the browsers through the cached Ubuntu action, bounded, before the Ubuntu tests', async () => {
    const workflow = await readRepoFile('.github/workflows/ci.yml')
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
      const steps = readSteps(job, '      ')
      const step = readStep(steps, install)
      expect(step).toContain(`uses: ${ubuntuInstallAction}\n`)
      expect(step).toContain(`browsers: ${browsers}\n`)
      expect(step).toMatch(/\n {8}timeout-minutes: \d+\n/)
      const names = [...steps.keys()]
      expect(names.indexOf(install)).toBeLessThan(names.indexOf(firstTest))
    }
  })

  it('installs browsers directly only on macOS, where there are no apt packages', async () => {
    const workflow = await readRepoFile('.github/workflows/ci.yml')
    const job = readJob(workflow, 'ci-macos', 'platform-e2e-windows')
    const steps = readSteps(job, '      ')
    const step = readStep(steps, 'Install Chromium for Desktop/Web continuity E2E')

    expect(step).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: ''")
    expect(step).toContain(`${directInstall} chromium`)
    const names = [...steps.keys()]
    expect(names.indexOf('Install Chromium for Desktop/Web continuity E2E')).toBeLessThan(
      names.indexOf('E2E tests (shard)'),
    )
    // A new Ubuntu job that installs browsers directly would download every package uncached.
    expect(workflow.split(directInstall).length - 1).toBe(1)
  })

  it('verifies every package file before the install and caches only .deb files', async () => {
    const action = await readRepoFile('.github/actions/install-playwright-browsers/action.yml')
    const steps = readSteps(action, '    ')
    const names = [...steps.keys()]
    const restore = 'Restore the Ubuntu package files'
    const verify = 'Drop package files that the package index does not vouch for'
    const install = 'Install the browsers and their packages'
    const save = 'Save the Ubuntu package files'

    // Restore, then verify against the index, then install, then save: the order is the contract.
    expect(names.indexOf(restore)).toBeGreaterThanOrEqual(0)
    expect(names.indexOf(restore)).toBeLessThan(names.indexOf(verify))
    expect(names.indexOf(verify)).toBeLessThan(names.indexOf(install))
    expect(names.indexOf(install)).toBeLessThan(names.indexOf(save))

    // The check runs whenever package files are present, whatever the restore step reported.
    const verifyStep = readStep(steps, verify)
    expect(verifyStep).not.toMatch(/\n {6}if:/)
    expect(verifyStep).toContain('sudo apt-get update')
    expect(verifyStep).toContain(
      'bash "$GITHUB_ACTION_PATH/drop-unverified-packages.sh" /var/cache/apt/archives',
    )
    expect(verifyStep.indexOf('sudo apt-get update')).toBeLessThan(
      verifyStep.indexOf('drop-unverified-packages.sh'),
    )

    // Restore and save the same files: apt's .deb archives, never its lock file or partial downloads.
    for (const name of [restore, save]) {
      expect(readStep(steps, name)).toContain('path: /var/cache/apt/archives/*.deb\n')
    }

    const installStep = readStep(steps, install)
    expect(installStep).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: ''")
    expect(installStep).toContain('pnpm exec playwright install --with-deps $BROWSERS')
    expect(readStep(steps, save)).toContain("steps.restore.outputs.cache-hit != 'true'")
  })
})
