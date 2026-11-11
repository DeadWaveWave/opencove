/** Independent test oracle: no imports from the publication, merge or projection implementation. */
export type Field =
  | 'name'
  | 'title'
  | 'collapsed'
  | 'sidebar'
  | 'sidebarRoot'
  | 'spaceOrder'
  | 'spacePinned'
export interface Value {
  name: string
  title: string
  collapsed: boolean
  sidebar: boolean
  sidebarRoot: boolean
  spaceOrder: string
  spacePinned: boolean
  tuple: string
  runtime: string
}
export interface Intent {
  field: Field
  value: string | boolean
  durable: boolean
  generation: number
}
export class ServerModel {
  revision = 1
  value: Value = {
    name: 'Project',
    title: 'Claude',
    collapsed: false,
    sidebar: false,
    sidebarRoot: false,
    spaceOrder: 'space,second',
    spacePinned: false,
    tuple: 'A',
    runtime: 'runtime',
  }
  history = new Map<number, Value>([[1, { ...this.value }]])
  intents: Intent[] = []
  verificationHistory = new Map<number, boolean>([[1, true]])
  verified = true
  verifiedRevision = 1
  unknown = false
  replayViolation = false
  external: { field: Field; value: string | boolean; generation: number } | null = null
  edit(field: Field, value: string | boolean) {
    this.intents.push({ field, value, durable: false, generation: this.intents.length + 1 })
  }
  commit(value: Value) {
    if (
      this.external &&
      (this.unknown || this.intents.some(i => i.field === this.external!.field && i.durable)) &&
      !this.intents.some(
        i => i.field === this.external!.field && i.generation > this.external!.generation,
      ) &&
      value[this.external.field] !== this.external.value
    ) {
      this.replayViolation = true
    }
    this.value = { ...value }
    this.history.set(++this.revision, { ...value })
    this.verificationHistory.set(this.revision, this.verified)
    for (const intent of this.intents) {
      if (value[intent.field] === intent.value) {
        intent.durable = true
      }
    }
  }
  thirdParty() {
    this.value.name = `external-${this.revision}`
    this.external = { field: 'name', value: this.value.name, generation: this.intents.length }
    this.history.set(++this.revision, { ...this.value })
    this.verificationHistory.set(this.revision, this.verified)
  }
  checkQuit(success: boolean) {
    if (!success) {
      return
    }
    for (const [index, intent] of this.intents.entries()) {
      if (this.intents.slice(index + 1).some(later => later.field === intent.field)) {
        continue
      }
      if (
        this.value[intent.field] !== intent.value &&
        !(this.external?.field === intent.field && this.external.generation >= intent.generation)
      ) {
        throw new Error(`I8: quit reported success before ${intent.field} became durable`)
      }
    }
  }
  check(
    observed: {
      ui: Value
      draft: Value | null
      accepted: Value | null
      revision: number | null
      viewConsistent: boolean
      cache: Value | null
      surfaced: boolean
      verified: boolean
      acceptedVerified: boolean
    },
    quiet: boolean,
    owned: boolean,
  ) {
    if (this.replayViolation) {
      throw new Error('I3: blind replay overwrote a later third-party write')
    }
    for (const [index, intent] of this.intents.entries()) {
      if (this.intents.slice(index + 1).some(later => later.field === intent.field)) {
        continue
      }
      if (
        this.value[intent.field] !== intent.value &&
        !(this.external?.field === intent.field && this.external.generation >= intent.generation) &&
        observed.ui[intent.field] !== intent.value &&
        !(observed.surfaced && observed.draft?.[intent.field] === intent.value)
      ) {
        throw new Error(
          `I1: lost ${intent.field} edit; ui=${JSON.stringify(observed.ui)} draft=${JSON.stringify(observed.draft)}`,
        )
      }
    }
    if (
      observed.accepted &&
      (JSON.stringify(observed.accepted) !== JSON.stringify(this.history.get(observed.revision!)) ||
        observed.acceptedVerified !== this.verificationHistory.get(observed.revision!))
    ) {
      throw new Error('I2: acknowledged content was not durable')
    }
    if (
      owned &&
      ((observed.accepted && observed.ui.tuple !== observed.accepted.tuple) ||
        ((observed.revision ?? 0) >= this.verifiedRevision && observed.verified !== this.verified))
    ) {
      throw new Error('I5: stale result replaced owned tuple')
    }
    if (!observed.viewConsistent) {
      throw new Error('I6: view-only preference caused inconsistency')
    }
    if (
      quiet &&
      (JSON.stringify(observed.ui) !== JSON.stringify(this.value) ||
        (observed.cache && JSON.stringify(observed.cache) !== JSON.stringify(this.value)))
    ) {
      throw new Error(
        `I4: quiescent UI/cache differs from canonical; ui=${JSON.stringify(observed.ui)} cache=${JSON.stringify(observed.cache)} server=${JSON.stringify(this.value)}`,
      )
    }
  }
}
export type Response =
  | 'committed'
  | 'corrected'
  | 'merged'
  | 'rejected'
  | 'identity'
  | 'lost-committed'
  | 'lost-uncommitted'
export type Action =
  | 'mount-renderer'
  | 'startup-refusal'
  | 'worker-upgrade'
  | 'connect-delivery'
  | 'disconnect-delivery'
  | 'restart-worker'
  | 'rename'
  | 'title'
  | 'collapse'
  | 'view'
  | 'schedule'
  | 'flush'
  | 'third-party'
  | 'event'
  | 'drop-event'
  | 'reverse-event'
  | 'observe'
  | 'refresh'
  | 'prepare'
  | 'fallback'
  | 'migration'
  | 'quit'
  | 'reconnect'
  | 'begin-write'
  | 'reply'
  | 'lose-next'
  | 'rebind'
  | 'settle'
  | 'associate'
  | 'capture'
  | 'new-acceptance'
  | 'stale-read'
  | 'restore-read'
  | 'raw-import'
  | 'sidebar-collapse'
  | 'sidebar-expand'
  | 'autosave'
  | 'cold-restart'
  | 'quit-timeout'
  | 'quit-failure'
  | 'begin-import'
  | 'flush-queued'
  | 'space-reorder'
  | 'space-pin'
export const responses: Response[] = [
  'committed',
  'corrected',
  'merged',
  'rejected',
  'identity',
  'lost-committed',
  'lost-uncommitted',
]
/** Enumerate all response/action pairs, plus longer fault windows; every trace is printable/replayable. */
export function explore(): Array<{ response: Response; actions: Action[] }> {
  const stimuli: Action[] = [
    'rename',
    'title',
    'collapse',
    'view',
    'third-party',
    'event',
    'drop-event',
    'reverse-event',
    'observe',
    'prepare',
    'fallback',
    'migration',
    'quit',
    'reconnect',
  ]
  return responses
    .flatMap(response =>
      stimuli.map(stimulus => ({
        response,
        actions: [
          'rename',
          'schedule',
          'flush',
          stimulus,
          'observe',
          'refresh',
          'reconnect',
        ] as Action[],
      })),
    )
    .concat(
      [
        {
          response: 'corrected',
          actions: [
            'rename',
            'flush',
            'title',
            'lose-next',
            'flush',
            'third-party',
            'observe',
            'refresh',
            'quit',
          ],
        },
        { response: 'committed', actions: ['rename', 'schedule', 'observe', 'refresh', 'flush'] },
        { response: 'corrected', actions: ['rename', 'flush', 'collapse', 'refresh', 'flush'] },
      ],
      responses.map(response => ({
        response,
        actions: [
          'rename',
          'begin-write',
          'third-party',
          'event',
          'observe',
          'refresh',
          'reply',
          'reconnect',
        ] as Action[],
      })),
      [
        {
          response: 'committed',
          actions: ['rename', 'capture', 'new-acceptance', 'quit', 'observe', 'refresh'],
        },
        {
          response: 'identity',
          actions: [
            'rename',
            'flush',
            'new-acceptance',
            'stale-read',
            'quit',
            'restore-read',
            'observe',
            'refresh',
          ],
        },
        {
          response: 'committed',
          actions: [
            'rebind',
            'observe',
            'refresh',
            'prepare',
            'settle',
            'observe',
            'refresh',
            'fallback',
            'associate',
            'observe',
            'refresh',
            'fallback',
          ],
        },
      ],
      [
        { response: 'committed', actions: ['rename', 'quit', 'cold-restart'] },
        { response: 'committed', actions: ['raw-import', 'observe', 'refresh'] },
        {
          response: 'committed',
          actions: [
            'sidebar-collapse',
            'autosave',
            'quit',
            'cold-restart',
            'cold-restart',
            'sidebar-expand',
            'autosave',
            'quit',
            'cold-restart',
            'cold-restart',
          ],
        },
        { response: 'committed', actions: ['rename', 'quit-timeout'] },
        { response: 'committed', actions: ['rename', 'quit-failure'] },
        {
          response: 'committed',
          actions: [
            'rename',
            'schedule',
            'begin-import',
            'title',
            'flush-queued',
            'reply',
            'observe',
            'refresh',
            'quit',
            'cold-restart',
          ],
        },
        {
          response: 'committed',
          actions: ['space-reorder', 'flush', 'view', 'observe', 'refresh', 'quit', 'cold-restart'],
        },
        {
          response: 'committed',
          actions: ['space-pin', 'flush', 'view', 'observe', 'refresh', 'quit', 'cold-restart'],
        },
      ],
    )
}
