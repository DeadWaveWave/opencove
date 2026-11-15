import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const realWorkflow = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'),
  'utf8',
)

// The text of one job: from its `  <id>:` line to the next job.
function jobText(workflow: string, id: string): string {
  const start = workflow.indexOf(`\n  ${id}:\n`)
  expect(start, `job ${id}`).toBeGreaterThanOrEqual(0)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

interface Step {
  name: string
  // Comment lines directly above the `- name:` line.
  comment: string
  body: string
}

function steps(job: string): Step[] {
  const lines = job.split('\n')
  const found: Step[] = []
  lines.forEach((line, index) => {
    const match = /^ {6}- name: (.+)$/.exec(line)
    if (!match) {
      return
    }
    const comment: string[] = []
    for (let up = index - 1; up >= 0 && /^ {6}#/.test(lines[up]!); up -= 1) {
      comment.unshift(lines[up]!.trim())
    }
    let end = index + 1
    while (end < lines.length && !/^ {6}- name: /.test(lines[end]!)) {
      end += 1
    }
    found.push({
      name: match[1]!,
      comment: comment.join('\n'),
      body: lines.slice(index, end).join('\n'),
    })
  })
  return found
}

function stepNamed(job: string, name: string): Step | undefined {
  return steps(job).find(candidate => candidate.name === name)
}

const NATIVE_ARGUMENTS = 'tests/integration/terminal/windowsNativeArguments.windows.spec.ts'
const NATIVE_STEP = 'Verify native PowerShell and WSL argument boundaries'
const WINDOWS_STEP = 'Windows-only Vitest files'
const MAC_STEP = 'macOS-only Vitest files'
const HOOK_STEP = 'Execute provider Hook relays with sanitized environments'
const WINDOWS_PREFIX = 'pnpm exec vitest run --pool=forks --maxWorkers=1 ".windows.spec."'
const MAC_COMMAND = 'pnpm exec vitest run --pool=forks --maxWorkers=1 ".mac.spec."'

// What is wrong with the two platform steps of `workflow`. Empty when they run every file of their
// platform, unconditionally and unnarrowed.
function platformStepProblems(workflow: string): string[] {
  const problems: string[] = []
  const windows = jobText(workflow, 'platform-e2e-windows')
  const mac = jobText(workflow, 'macos-platform')
  const windowsStep = stepNamed(windows, WINDOWS_STEP)
  const macStep = stepNamed(mac, MAC_STEP)

  for (const [step, command] of [
    [windowsStep, WINDOWS_PREFIX],
    [macStep, MAC_COMMAND],
  ] as const) {
    if (!step) {
      problems.push('a platform step is missing')
      continue
    }
    if (/^\s+if:/m.test(step.body)) {
      problems.push(`${step.name}: must not have an if: condition`)
    }
    if (/continue-on-error/.test(step.body)) {
      problems.push(`${step.name}: must not have continue-on-error`)
    }
    const run = /^ {8}run: (.+)$/m.exec(step.body)?.[1] ?? ''
    if (step === macStep ? run !== command : !run.startsWith(`${command}`)) {
      problems.push(`${step.name}: the command is not pinned (got "${run}")`)
    }
  }

  if (windowsStep) {
    const run = /^ {8}run: (.+)$/m.exec(windowsStep.body)?.[1] ?? ''
    const rest = run.startsWith(WINDOWS_PREFIX) ? run.slice(WINDOWS_PREFIX.length) : ''
    if (!/^( --exclude[= ]\S+)+$/.test(rest)) {
      problems.push(
        `${WINDOWS_STEP}: only --exclude arguments may follow the pinned command (got "${rest}")`,
      )
    }
    const excluded = [...rest.matchAll(/--exclude[= ](\S+)/g)].map(match => match[1]!)
    if (!excluded.includes(NATIVE_ARGUMENTS)) {
      problems.push(`${WINDOWS_STEP}: must exclude ${NATIVE_ARGUMENTS}`)
    }
    if (!windowsStep.comment.includes(NATIVE_STEP)) {
      problems.push(`${WINDOWS_STEP}: the comment must name the step "${NATIVE_STEP}"`)
    }
    const commentLines = windowsStep.comment.split('\n')
    for (const path of excluded.filter(item => item !== NATIVE_ARGUMENTS)) {
      const named = commentLines.some(line => line.includes(path) && /#\d+/.test(line))
      if (!named) {
        problems.push(
          `${WINDOWS_STEP}: exclusion ${path} needs a comment line naming it and an issue #N`,
        )
      }
    }
  }
  const nativeStep = stepNamed(windows, NATIVE_STEP)
  if (!nativeStep?.body.includes(NATIVE_ARGUMENTS)) {
    problems.push(`step "${NATIVE_STEP}" must run ${NATIVE_ARGUMENTS}`)
  }

  for (const step of steps(windows)) {
    // The pattern step names its exclusions, which are judged above.
    if (step.name === WINDOWS_STEP || !/\bvitest\b/.test(step.body)) {
      continue
    }
    for (const file of step.body.match(/[\w./-]+\.windows\.spec\.tsx?/g) ?? []) {
      if (file !== NATIVE_ARGUMENTS) {
        problems.push(`${step.name} names ${file}`)
      }
    }
  }
  if (/[\w./-]+\.mac\.spec\.tsx?/.test(mac)) {
    problems.push('the macOS job names a *.mac.spec.* file')
  }
  const macSteps = steps(mac)
  if (
    macStep &&
    macSteps.findIndex(item => item.name === MAC_STEP) <
      macSteps.findIndex(item => item.name === 'Build')
  ) {
    problems.push(`${MAC_STEP} must run after Build`)
  }

  const hook = stepNamed(windows, HOOK_STEP)
  if (!hook?.body.includes('tests/integration/agentHookRelay.spec.ts')) {
    problems.push(`step "${HOOK_STEP}" must run tests/integration/agentHookRelay.spec.ts`)
  } else if (!hook.comment.includes('Ubuntu') || !hook.comment.includes('cross-platform')) {
    problems.push(`step "${HOOK_STEP}" needs a comment giving the reason`)
  }
  return problems
}

describe('the Windows and macOS Vitest steps', () => {
  it('select every file of their platform by name pattern, unconditionally and unnarrowed', () => {
    expect(platformStepProblems(realWorkflow)).toEqual([])
  })

  // Each mutation is applied to the real workflow text and must be reported.
  const mutate = (from: string, to: string) => realWorkflow.replace(from, to)
  const windowsName = `      - name: ${WINDOWS_STEP}\n`
  const macName = `      - name: ${MAC_STEP}\n`
  const windowsRun = `${WINDOWS_PREFIX} --exclude ${NATIVE_ARGUMENTS}`
  it.each([
    [
      'if: false on the Windows step',
      mutate(windowsName, `${windowsName}        if: false\n`),
      'must not have an if:',
    ],
    [
      'continue-on-error on the Windows step',
      mutate(windowsName, `${windowsName}        continue-on-error: true\n`),
      'continue-on-error',
    ],
    [
      'if: false on the macOS step',
      mutate(macName, `${macName}        if: false\n`),
      'must not have an if:',
    ],
    [
      'continue-on-error on the macOS step',
      mutate(macName, `${macName}        continue-on-error: true\n`),
      'continue-on-error',
    ],
    [
      '-t appended to the Windows command',
      mutate(windowsRun, `${windowsRun} -t nothing-matches`),
      'only --exclude arguments',
    ],
    [
      '--testNamePattern appended to the macOS command',
      mutate(MAC_COMMAND, `${MAC_COMMAND} --testNamePattern nothing`),
      'the command is not pinned',
    ],
    [
      'a different pattern in the macOS command',
      mutate(MAC_COMMAND, MAC_COMMAND.replace('.mac.spec.', '.mac.spec.ts')),
      'the command is not pinned',
    ],
    [
      'a glob exclusion written with =',
      mutate(windowsRun, `${windowsRun} --exclude=**/cliIdentity*`),
      'needs a comment line naming it',
    ],
    [
      'a file exclusion with no issue',
      mutate(windowsRun, `${windowsRun} --exclude tests/unit/app/cliSpawnHints.windows.spec.ts`),
      'needs a comment line naming it',
    ],
    [
      'an issue number that belongs to another exclusion',
      mutate(
        windowsRun,
        `${windowsRun} --exclude tests/unit/app/cliSpawnHints.windows.spec.ts`,
      ).replace(
        '      - name: Windows-only Vitest files',
        '      # tests/unit/app/cliIdentityShell.windows.spec.ts is excluded, see #1\n      - name: Windows-only Vitest files',
      ),
      'cliSpawnHints.windows.spec.ts needs a comment line naming it',
    ],
    [
      'the native exclusion dropped',
      mutate(` --exclude ${NATIVE_ARGUMENTS}`, ''),
      'only --exclude arguments',
    ],
    [
      'the macOS step renamed',
      mutate(macName, '      - name: Mac tests\n'),
      'a platform step is missing',
    ],
  ])('reports %s', (_name, workflow, expected) => {
    expect(platformStepProblems(workflow).join('\n')).toContain(expected)
  })

  it('accepts an extra exclusion whose comment line names the file and cites an issue', () => {
    const workflow = mutate(
      windowsRun,
      `${windowsRun} --exclude tests/unit/app/cliSpawnHints.windows.spec.ts`,
    ).replace(
      '      - name: Windows-only Vitest files',
      '      # tests/unit/app/cliSpawnHints.windows.spec.ts is excluded until #123 is fixed\n      - name: Windows-only Vitest files',
    )
    expect(platformStepProblems(workflow)).toEqual([])
  })

  it('reports a Hook relay step without its reason', () => {
    const workflow = mutate('cross-platform, not Windows-only', 'not Windows-only')
    expect(platformStepProblems(workflow).join('\n')).toContain('needs a comment giving the reason')
  })
})
