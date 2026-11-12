export type Step =
  | {
      kind: 'hook'
      id: string
      name: string
      source?: 'startup' | 'resume' | 'compact'
      prompt?: string
      notification?: string
      stampOffset?: number
    }
  | { kind: 'capture'; watcher: string; id: string | null }
  | { kind: 'bind'; watcher: string; id: string }
  | { kind: 'file'; watcher: string; state: 'working' | 'waiting' | 'standby' }
  | { kind: 'dispose_watcher'; watcher: string }
export type Case = { id: string; provider?: 'codex'; steps: Step[] }
const start = (id = 'A', source: 'startup' | 'resume' | 'compact' = 'startup'): Step => ({
  kind: 'hook',
  id,
  name: 'SessionStart',
  source,
})
const submit = (id = 'A', prompt = `${id}-prompt`): Step => ({
  kind: 'hook',
  id,
  name: 'UserPromptSubmit',
  prompt,
})
const stop = (id = 'A', prompt = `${id}-prompt`): Step => ({
  kind: 'hook',
  id,
  name: 'Stop',
  prompt,
})
const wait = (id = 'A'): Step => ({ kind: 'hook', id, name: 'PermissionRequest' })
const notify = (notification: string): Step => ({
  kind: 'hook',
  id: 'A',
  name: 'Notification',
  notification,
})
const capture = (id: string | null = 'A'): Step => ({ kind: 'capture', watcher: 'file', id })
const file = (state: 'working' | 'waiting' | 'standby'): Step => ({
  kind: 'file',
  watcher: 'file',
  state,
})
export const corpus: Case[] = [
  { id: 'startup', steps: [start()] },
  { id: 'startup-turn', steps: [start(), submit(), stop()] },
  {
    id: 'resume-new-identity',
    steps: [start(), submit(), stop(), start('B', 'resume'), submit('B'), stop('B')],
  },
  {
    id: 'resume-return-identity',
    steps: [
      start(),
      start('B', 'resume'),
      submit('B'),
      stop('B'),
      start('A', 'resume'),
      submit(),
      stop(),
    ],
  },
  {
    id: 'resume-return-after-completion',
    steps: [
      start(),
      submit('A', 'a-first'),
      stop('A', 'a-first'),
      start('B', 'resume'),
      submit('B'),
      stop('B'),
      start('A', 'resume'),
      submit('A', 'a-second'),
      stop('A', 'a-second'),
    ],
  },
  {
    id: 'startup-return-identity',
    steps: [start(), start('B'), submit('B'), stop('B'), start(), submit()],
  },
  {
    id: 'resume-while-working',
    steps: [start(), submit(), start('B', 'resume'), submit('B'), stop('B')],
  },
  {
    id: 'resume-while-waiting',
    steps: [start(), submit(), wait(), start('B', 'resume'), submit('B'), stop('B')],
  },
  {
    id: 'ordinary-session-end',
    steps: [start(), submit(), stop(), { kind: 'hook', id: 'A', name: 'SessionEnd' }],
  },
  {
    id: 'ordinary-end-before-stop',
    steps: [start(), submit(), { kind: 'hook', id: 'A', name: 'SessionEnd' }, stop()],
  },
  {
    id: 'ordinary-end-queued',
    steps: [start(), submit(), submit(), stop(), { kind: 'hook', id: 'A', name: 'SessionEnd' }],
  },
  { id: 'same-identity-resume', steps: [start(), submit(), start('A', 'resume'), stop()] },
  { id: 'compact-working', steps: [start(), submit(), start('A', 'compact'), stop()] },
  { id: 'compact-waiting', steps: [start(), submit(), wait(), start('A', 'compact'), stop()] },
  { id: 'file-only', steps: [capture(), file('working'), file('standby'), file('working')] },
  {
    id: 'file-only-discovery',
    steps: [
      capture(null),
      { kind: 'bind', watcher: 'file', id: 'A' },
      file('working'),
      file('waiting'),
      file('standby'),
    ],
  },
  {
    id: 'hooks-and-file',
    steps: [capture(), start(), file('working'), submit(), file('standby'), wait(), stop()],
  },
  {
    id: 'file-after-hook-completion',
    steps: [
      start(),
      submit(),
      stop(),
      capture(),
      file('working'),
      file('waiting'),
      file('standby'),
    ],
  },
  {
    id: 'disposed-watcher',
    steps: [
      capture(),
      start(),
      submit(),
      { kind: 'dispose_watcher', watcher: 'file' },
      file('working'),
      stop(),
    ],
  },
  {
    id: 'stale-watcher-after-resume',
    steps: [
      start(),
      submit(),
      stop(),
      capture(),
      start('B', 'resume'),
      submit('B'),
      file('working'),
      stop('B'),
    ],
  },
  { id: 'permission', steps: [start(), submit(), wait(), stop()] },
  {
    id: 'waiting-notification',
    steps: [start(), submit(), notify('permission_prompt'), notify('elicitation_complete'), stop()],
  },
  {
    id: 'passive-notification',
    steps: [start(), submit(), notify('idle_prompt'), notify('auth_success'), stop()],
  },
  {
    id: 'stale-predecessor-stop',
    steps: [start(), submit(), stop(), start('B', 'resume'), submit('B'), stop(), stop('B')],
  },
  {
    id: 'stale-resume',
    steps: [
      start(),
      start('B', 'resume'),
      submit('B'),
      stop('B'),
      { ...start('A', 'resume'), stampOffset: -1000 } as Step,
    ],
  },
  { id: 'codex-turn', provider: 'codex', steps: [submit(), stop()] },
  {
    id: 'codex-file-permission',
    provider: 'codex',
    steps: [submit(), capture(), file('working'), wait(), stop()],
  },
  {
    id: 'codex-two-turns',
    provider: 'codex',
    steps: [submit('A', 'c-one'), stop('A', 'c-one'), submit('A', 'c-two'), stop('A', 'c-two')],
  },
]
