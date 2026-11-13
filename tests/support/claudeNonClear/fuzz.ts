import type { Case, Step } from './corpus'

export const FUZZ_SEEDS = [0xb4000001, 0xb4000101, 0xb4000201, 0xb4000301, 0xb4000401]
export const CASES_PER_SEED = 1000
export function fuzzCases(seed: number): Case[] {
  let state = seed >>> 0
  const random = (bound: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % bound
  }
  return Array.from({ length: CASES_PER_SEED }, (_, index) => {
    const hooks: Step[] = []
    const hook = (id: string, name: string, source?: 'startup' | 'resume' | 'compact'): Step => ({
      kind: 'hook',
      id,
      name,
      source,
      prompt: `p${random(4)}`,
      notification: ['idle_prompt', 'auth_success', 'permission_prompt', 'elicitation_complete'][
        random(4)
      ],
    })
    if (index % 32 === 0) {
      hooks.push(hook('A', 'SessionStart', 'startup'))
      for (let n = 0; n < 66 + random(8); n++) {
        const id = `R${n}`
        hooks.push(
          hook(id, 'SessionStart', 'resume'),
          hook(id, 'UserPromptSubmit'),
          hook(id, 'Stop'),
        )
      }
    } else {
      for (let n = 0, count = 5 + random(20); n < count; n++) {
        const id = ['A', 'B', 'C', `N${n}`][random(4)]
        if (random(4) === 0) {
          hooks.push({
            kind: 'file',
            watcher: 'file',
            state: (['working', 'waiting', 'standby'] as const)[random(3)],
            ...(random(2) ? { generation: random(90), id } : {}),
          })
        } else {
          const name = [
            'SessionStart',
            'UserPromptSubmit',
            'Stop',
            'PermissionRequest',
            'Notification',
            'SessionEnd',
          ][random(6)]
          hooks.push(hook(id, name, (['startup', 'resume', 'compact'] as const)[random(3)]))
        }
      }
      // Preserve relay time while varying delivery; captures remain before all file callbacks.
      hooks.forEach((step, n) => {
        if (step.kind === 'hook') {
          step.stampOffset = n * 10
        }
      })
      for (let n = hooks.length - 1; n > 0; n--) {
        const at = random(n + 1)
        ;[hooks[n], hooks[at]] = [hooks[at], hooks[n]]
      }
      hooks.forEach((step, n) => {
        if (step.kind === 'hook') {
          step.stampOffset! -= n * 10
        }
      })
    }
    const transcriptIO = index % 5 === 1 && index % 32 !== 0
    if (transcriptIO) {
      const id = 'T',
        prompt = `io-${random(4)}`
      const variant = (
        ['metadata', 'identified-metadata', 'local-command', 'command-markup'] as const
      )[random(4)]
      hooks.push(
        { kind: 'hook', id, name: 'SessionStart', source: 'resume' },
        { kind: 'hook', id, name: 'UserPromptSubmit', prompt },
        { kind: 'transcript', id, variant: 'user', prompt },
        { kind: 'transcript', id, variant: 'enqueue' },
        { kind: 'transcript', id, variant, prompt: 'queued' },
        { kind: 'transcript', id, variant: 'remove' },
        { kind: 'transcript', id, variant: 'assistant', prompt },
        { kind: 'checkpoint', id },
        { kind: 'hook', id, name: 'Stop', prompt },
        { kind: 'timeout', ms: 6001 },
      )
    }
    return {
      id: `${seed}-${index}`,
      terminal: random(2) === 0,
      transcriptIO,
      steps: [{ kind: 'capture', watcher: 'file', id: null }, ...hooks],
    }
  })
}

/** Deletion minimization reaches a 1-minimal reproducer, preserving the required watcher capture. */
export async function minimizeCase(
  scenario: Case,
  differs: (value: Case) => Promise<boolean>,
): Promise<Case> {
  let elapsed = 0
  let result = {
    ...scenario,
    steps: scenario.steps.map((step, index) => {
      if (step.kind === 'timeout') {
        elapsed += step.ms
      }
      return step.kind === 'hook'
        ? {
            ...step,
            relayAt: step.relayAt ?? 100010 + index * 10 + elapsed + (step.stampOffset ?? 0),
          }
        : step
    }),
  }
  let width = Math.max(1, Math.floor(result.steps.length / 2))
  while (width >= 1) {
    let changed = false
    for (let index = 1; index < result.steps.length; index++) {
      const candidate = {
        ...result,
        steps: result.steps.filter((_, n) => n < index || n >= index + width),
      }
      // oxlint-disable-next-line no-await-in-loop -- each shrink depends on the previous result
      if (await differs(candidate)) {
        result = candidate
        changed = true
        break
      }
    }
    if (!changed) {
      width = Math.floor(width / 2)
    }
  }
  return result
}
