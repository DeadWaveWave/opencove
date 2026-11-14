import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(import.meta.dirname, '../../..')

interface Step {
  name: string
  text: string
}

function readJob(workflow: string, jobName: string, nextJobName: string): string {
  const start = workflow.indexOf(`  ${jobName}:`)
  const end = workflow.indexOf(`  ${nextJobName}:`, start + 1)
  if (start < 0 || end < 0) {
    throw new Error(`Missing CI job boundary for ${jobName}`)
  }
  return workflow.slice(start, end)
}

function readSteps(job: string): Step[] {
  const chunks = job.split(/^ {6}- name: /m).slice(1)
  return chunks.map(chunk => ({ name: chunk.split('\n', 1)[0]!.trim(), text: chunk }))
}

function readStep(job: string, name: string): Step {
  const step = readSteps(job).find(candidate => candidate.name === name)
  if (!step) {
    throw new Error(`Missing CI step "${name}"`)
  }
  return step
}

function readRunCommand(step: Step): string {
  const lines = step.text.split('\n')
  const runAt = lines.findIndex(line => /^ {8}run:/.test(line))
  if (runAt < 0) {
    throw new Error(`Step "${step.name}" has no run command`)
  }
  const first = lines[runAt]!.replace(/^ {8}run:\s*/, '')
  const rest: string[] = []
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== '' && !/^ {10}/.test(line)) {
      break
    }
    rest.push(line.trim())
  }
  return [first.replace(/^(>-|\|)$/, ''), ...rest].join(' ').replace(/\s+/g, ' ').trim()
}

interface RunnerRow {
  runner: string
  selects: (file: string) => boolean
  runsIn: (workflow: string, webJob: string) => boolean
  /** Matches the run command of the steps that run this row (for the step-switch check). */
  stepRun: RegExp
  /** Set when no step of the row can be free of `if:`; the reason is the value. */
  gatingExemption?: string
}

const startsWith = (prefix: string) => (file: string) => file.startsWith(prefix)

const RUNNER_ROWS: RunnerRow[] = [
  {
    runner: 'Vitest, root config',
    selects: file =>
      startsWith('src/')(file) ||
      startsWith('tests/unit/')(file) ||
      startsWith('tests/integration/')(file) ||
      (startsWith('tests/contract/')(file) && !startsWith('tests/contract/worker-cli/')(file)),
    runsIn: workflow => /^\s+run: pnpm test -- --run\s*$/m.test(workflow),
    stepRun: /^pnpm test -- --run$/,
    // The only step that runs this command is "Unit tests (PR)", which has
    // `if: github.event_name == 'pull_request'` because pushes run test:coverage instead.
    gatingExemption: 'pull_request-only step; push runs the same files under pnpm test:coverage',
  },
  {
    runner: 'Vitest, architecture harness',
    selects: startsWith('harness/'),
    runsIn: workflow => /^\s+run: pnpm arch:test\s*$/m.test(workflow),
    stepRun: /^pnpm arch:test$/,
  },
  {
    runner: 'Playwright, Worker CLI contracts',
    selects: startsWith('tests/contract/worker-cli/'),
    runsIn: workflow => /^\s+run: pnpm test:contract:worker-cli\s*$/m.test(workflow),
    stepRun: /^pnpm test:contract:worker-cli$/,
  },
  {
    runner: 'Playwright, Desktop E2E',
    selects: startsWith('tests/e2e/'),
    runsIn: workflow => /plan-e2e-shards\.mjs --os ubuntu .* --run/.test(workflow),
    stepRun: /plan-e2e-shards\.mjs --os ubuntu .* --run/,
  },
  {
    runner: 'Playwright, web canvas',
    selects: startsWith('tests/e2e-web-canvas/'),
    runsIn: (_workflow, webJob) =>
      readRunCommand(readStep(webJob, 'Web canvas tests (chromium)')).startsWith(
        'pnpm test:e2e:web-canvas --',
      ),
    stepRun: /^pnpm test:e2e:web-canvas -- --project=chromium /,
  },
  {
    runner: 'Playwright, web shell',
    selects: startsWith('tests/e2e-web-shell/'),
    runsIn: (_workflow, webJob) =>
      readSteps(webJob).some(step => /^\s+run: pnpm test:e2e:web-shell\b/m.test(step.text)),
    stepRun: /^pnpm test:e2e:web-shell /,
    // Its step carries the exact `if:` pinned by 'lets the WebKit and web shell suites report'.
    gatingExemption: 'pinned by its own test, with the exact if: of the web suites',
  },
]

const STEP_IF = /^ {8}if:/m
const STEP_CONTINUE_ON_ERROR = /^ {8}continue-on-error:/m

function readStepIf(step: Step): string | null {
  return step.text.match(/^ {8}if:\s*(.*)$/m)?.[1]?.trim() ?? null
}

/** A step the row's runner runs on every pull request and that can fail the job. */
function hasUngatedStep(workflow: string, row: RunnerRow): boolean {
  return readSteps(workflow).some(step => {
    let command: string
    try {
      command = readRunCommand(step)
    } catch {
      return false
    }
    return (
      row.stepRun.test(command) &&
      !STEP_IF.test(step.text) &&
      !STEP_CONTINUE_ON_ERROR.test(step.text)
    )
  })
}

const FIXTURE_PREFIX = 'tests/fixtures/'

/** Assertion 1: every spec file belongs to exactly one runner row. */
function findSpecsWithoutExactlyOneRunner(files: string[], rows = RUNNER_ROWS): string[] {
  return files
    .filter(file => /\.spec\.tsx?$/.test(file) && !file.startsWith(FIXTURE_PREFIX))
    .filter(file => rows.filter(row => row.selects(file)).length !== 1)
}

/** Assertion 2: every runner row has a CI step that runs its command. */
function findRunnersWithoutCiStep(workflow: string, webJob: string, rows = RUNNER_ROWS): string[] {
  return rows
    .filter(row => {
      try {
        return !row.runsIn(workflow, webJob)
      } catch {
        return true
      }
    })
    .map(row => row.runner)
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8' })
    .split('\n')
    .filter(line => line.length > 0)
    .filter(file => existsSync(resolve(rootDir, file)))
}

describe('CI web suites', () => {
  async function readWorkflow(): Promise<{ workflow: string; webJob: string }> {
    const workflow = await readFile(resolve(rootDir, '.github/workflows/ci.yml'), 'utf8')
    return {
      workflow,
      webJob: readJob(workflow, 'web-canvas-continuity-ubuntu', 'worker-cli-macos'),
    }
  }

  it('runs the whole web canvas directory on chromium, selected by directory', async () => {
    const { webJob } = await readWorkflow()
    const step = readStep(webJob, 'Web canvas tests (chromium)')

    expect(readRunCommand(step)).toBe('pnpm test:e2e:web-canvas -- --project=chromium --retries=0')
    expect(readRunCommand(step)).not.toContain('tests/')
    expect(step.text).toContain("OPENCOVE_E2E_RETRIES: '0'")
    expect(step.text).toMatch(/^ {8}timeout-minutes: 30$/m)
    // The chromium step is the base suite: it is never conditional and never allowed to fail quietly.
    expect(step.text).not.toMatch(STEP_IF)
    expect(step.text).not.toMatch(STEP_CONTINUE_ON_ERROR)
  })

  it.each([
    ['playwright.web-canvas.config.ts', './tests/e2e-web-canvas'],
    ['playwright.web-shell.config.ts', './tests/e2e-web-shell'],
  ])('keeps %s selecting its whole directory', async (name, testDir) => {
    const source = await readFile(resolve(rootDir, name), 'utf8')

    expect(source).toContain(`testDir: '${testDir}'`)
    expect(source).toContain("testMatch: '**/*.spec.ts'")
    expect(source).not.toMatch(/\btestIgnore\b|\bgrep(Invert)?\s*:/)
  })

  it('lets the WebKit and web shell suites report whenever the build succeeded', async () => {
    const { webJob } = await readWorkflow()
    const expectedIf = "${{ !cancelled() && steps.build.conclusion == 'success' }}"

    expect(readStepIf(readStep(webJob, 'WebKit calibration and theme tests'))).toBe(expectedIf)
    expect(readStepIf(readStep(webJob, 'Web shell tests (chromium)'))).toBe(expectedIf)
    expect(readStep(webJob, 'Build').text).toMatch(/^ {8}id: build$/m)
    for (const name of ['WebKit calibration and theme tests', 'Web shell tests (chromium)']) {
      expect(readStep(webJob, name).text, name).not.toMatch(STEP_CONTINUE_ON_ERROR)
    }
  })

  it('lists only existing files in the WebKit subset and says why it is a subset', async () => {
    const { webJob } = await readWorkflow()
    const step = readStep(webJob, 'WebKit calibration and theme tests')
    const command = readRunCommand(step)
    const files = command.split(' ').filter(argument => argument.startsWith('tests/'))

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(file, file).toMatch(/^tests\/e2e-web-canvas\/[^/]+\.spec\.ts$/)
      expect(existsSync(resolve(rootDir, file)), file).toBe(true)
    }
    expect(command).toContain('--project=webkit')

    const lines = webJob.split('\n')
    const stepAt = lines.findIndex(line =>
      line.includes('- name: WebKit calibration and theme tests'),
    )
    expect(lines[stepAt - 1]).toMatch(/^ {6}# WebKit subset: /)
  })

  it('runs the web shell suite with retries pinned to 0 and uploads its artifacts', async () => {
    const { webJob } = await readWorkflow()
    const step = readStep(webJob, 'Web shell tests (chromium)')

    expect(readRunCommand(step)).toBe('pnpm test:e2e:web-shell -- --retries=0')
    expect(step.text).toContain("OPENCOVE_E2E_RETRIES: '0'")
    expect(step.text).toContain("OPENCOVE_E2E_SKIP_BUILD: '1'")
    expect(step.text).toMatch(/^ {8}timeout-minutes: 10$/m)

    const upload = readStep(webJob, 'Upload Web Canvas artifacts').text
    for (const path of [
      'test-results-web-canvas/',
      'playwright-report-web-canvas/',
      'test-results-web-shell/',
      'playwright-report-web-shell/',
    ]) {
      expect(upload).toContain(path)
    }

    const shellConfig = await readFile(resolve(rootDir, 'playwright.web-shell.config.ts'), 'utf8')
    expect(shellConfig).not.toMatch(/process\.env\.CI\s*\?/)
  })

  it('makes both web runners start the stub agent with real Node', async () => {
    for (const name of ['test-e2e-web-canvas.mjs', 'test-e2e-web-shell.mjs']) {
      const source = await readFile(resolve(rootDir, 'scripts', name), 'utf8')
      expect(source, name).toContain('OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath')
    }
  })

  describe('every spec file belongs to a runner that CI runs', () => {
    it('gives every tracked spec file exactly one runner row', () => {
      expect(findSpecsWithoutExactlyOneRunner(trackedFiles())).toEqual([])
    })

    it('fails for a spec file under a directory that no row selects', () => {
      const files = [...trackedFiles(), 'tests/e2e-web-new/example.spec.ts', 'tests/e2e/x.spec.ts']
      expect(findSpecsWithoutExactlyOneRunner(files)).toEqual(['tests/e2e-web-new/example.spec.ts'])
    })

    it('has a CI step for every runner row', async () => {
      const { workflow, webJob } = await readWorkflow()
      expect(findRunnersWithoutCiStep(workflow, webJob)).toEqual([])
    })

    it('has, for every runner row, a step that is neither conditional nor allowed to fail', async () => {
      const { workflow } = await readWorkflow()

      for (const row of RUNNER_ROWS) {
        if (row.gatingExemption) {
          expect(row.gatingExemption.length).toBeGreaterThan(0)
          continue
        }
        expect(hasUngatedStep(workflow, row), row.runner).toBe(true)
      }
    })

    it('fails when a runner step is switched off with if or continue-on-error', async () => {
      const { workflow } = await readWorkflow()
      const row = RUNNER_ROWS.find(
        candidate => candidate.runner === 'Vitest, architecture harness',
      )!

      expect(
        hasUngatedStep(
          workflow.replace(
            '      - name: Architecture harness tests\n',
            '      - name: Architecture harness tests\n        if: false\n',
          ),
          row,
        ),
      ).toBe(false)
      expect(
        hasUngatedStep(
          workflow.replace(
            '      - name: Architecture harness tests\n',
            '      - name: Architecture harness tests\n        continue-on-error: true\n',
          ),
          row,
        ),
      ).toBe(false)
    })

    it('fails when the web shell step is removed from the workflow text', async () => {
      const { workflow, webJob } = await readWorkflow()
      const withoutShell = (text: string): string =>
        text.replace(/pnpm test:e2e:web-shell/g, 'pnpm removed-step')

      expect(findRunnersWithoutCiStep(withoutShell(workflow), withoutShell(webJob))).toEqual([
        'Playwright, web shell',
      ])
    })

    it('fails when the web canvas step no longer runs the directory runner', async () => {
      const { workflow, webJob } = await readWorkflow()
      const broken = webJob.replace('pnpm test:e2e:web-canvas -- --project=chromium', 'pnpm other')
      expect(findRunnersWithoutCiStep(workflow, broken)).toContain('Playwright, web canvas')
    })
  })
})
