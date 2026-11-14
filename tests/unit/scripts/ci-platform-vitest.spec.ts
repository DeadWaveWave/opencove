import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'),
  'utf8',
)

// The text of one job: from its `  <id>:` line to the next job.
function jobText(id: string): string {
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

function stepNamed(job: string, name: string): Step {
  const step = steps(job).find(candidate => candidate.name === name)
  expect(step, `step "${name}"`).toBeDefined()
  return step!
}

const NATIVE_ARGUMENTS = 'tests/integration/terminal/windowsNativeArguments.windows.spec.ts'
const NATIVE_STEP = 'Verify native PowerShell and WSL argument boundaries'

describe('Windows job selects its Vitest files by pattern', () => {
  const job = jobText('platform-e2e-windows')

  it('runs every *.windows.spec.* Vitest file in one step, minus the file with its own step', () => {
    const step = stepNamed(job, 'Windows-only Vitest files')
    expect(step.body).toContain(
      `run: pnpm exec vitest run --pool=forks --maxWorkers=1 ".windows.spec." --exclude ${NATIVE_ARGUMENTS}`,
    )
  })

  it('names no *.windows.spec.* file in any other Vitest step, except the excluded native one', () => {
    for (const step of steps(job)) {
      if (!/\bvitest\b/.test(step.body)) {
        continue
      }
      const named = step.body.match(/[\w./-]+\.windows\.spec\.tsx?/g) ?? []
      for (const file of named) {
        expect(file, `${step.name} names ${file}`).toBe(NATIVE_ARGUMENTS)
      }
    }
  })

  it('names the step that runs the excluded file, in a comment above the exclusion', () => {
    const step = stepNamed(job, 'Windows-only Vitest files')
    expect(step.comment).toContain(NATIVE_STEP)
    expect(stepNamed(job, NATIVE_STEP).body).toContain(NATIVE_ARGUMENTS)
  })

  it('requires every other exclusion to cite an issue number in its comment', () => {
    const step = stepNamed(job, 'Windows-only Vitest files')
    const excluded = [...step.body.matchAll(/--exclude\s+(\S+)/g)].map(match => match[1])
    expect(excluded).toContain(NATIVE_ARGUMENTS)
    for (const file of excluded.filter(file => file !== NATIVE_ARGUMENTS)) {
      expect(step.comment, `exclusion ${file} needs a #issue in the comment`).toMatch(/#\d+/)
    }
  })

  it('keeps the cross-platform Hook relay file in its own step, with the reason', () => {
    const step = stepNamed(job, 'Execute provider Hook relays with sanitized environments')
    expect(step.body).toContain('tests/integration/agentHookRelay.spec.ts')
    expect(step.comment).toContain('Ubuntu')
    expect(step.comment).toContain('cross-platform')
  })
})

describe('macOS job selects its Vitest files by pattern', () => {
  const job = jobText('worker-cli-macos')

  it('runs every *.mac.spec.* Vitest file after the build', () => {
    const all = steps(job)
    const step = stepNamed(job, 'macOS-only Vitest files')
    expect(step.body).toContain(
      'run: pnpm exec vitest run --pool=forks --maxWorkers=1 ".mac.spec."',
    )
    expect(all.findIndex(item => item.name === step.name)).toBeGreaterThan(
      all.findIndex(item => item.name === 'Build'),
    )
  })

  it('names no *.mac.spec.* file in any step', () => {
    expect(job).not.toMatch(/[\w./-]+\.mac\.spec\.tsx?/)
  })
})
