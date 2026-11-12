import { defineCommand } from '../core/command'
import { usage } from '../core/errors'
import { eventTypes, decodeEventCursor } from '../../../shared/contracts/dto/eventStream'
import { runEvents } from '../core/events'
import { streamLifetime } from '../core/streamLifetime'
const selector = (description: string) => ({
  type: 'string' as const,
  defaultSelf: false,
  valueName: 'selector',
  description,
})
export const eventsCommand = defineCommand({
  path: ['events'],
  summary: 'Stream agent observations with resumable cursors',
  connect: true,
  stream: true,
  streamProjection: true,
  resolveInExecute: true,
  executionScope: streamLifetime,
  description:
    'Write compact NDJSON, starting with stream.ready. Resume manually with --after and the last printed cursor. A gap is terminal (exit 1); a lost connection exits 3. Scoped streams include only events published after binding. Turn completion reports an observation; inspect its outcome. Timeout or signals close observation without stopping agents.',
  options: {
    type: {
      type: 'string',
      multiple: true,
      choices: eventTypes,
      description: 'Include an exact agent event type; repeat to include both',
    },
    project: selector('Filter event-time project membership'),
    space: selector('Filter event-time Space membership'),
    node: selector('Filter observations bound to one node'),
    'spawned-by': {
      ...selector('Filter direct creation children, including children created later'),
      selector: 'node',
      conflicts: ['lineage'],
    },
    lineage: {
      ...selector('Filter a node and its transitive creation descendants'),
      selector: 'node',
      conflicts: ['spawned-by'],
    },
    after: {
      type: 'string',
      valueName: 'cursor',
      description: 'Replay after a saved cursor; inherit its selection unless explicitly supplied',
    },
    count: {
      type: 'number',
      valueName: 'n',
      description: 'Stop after writing n data records; requires a positive whole number',
    },
    until: {
      type: 'string',
      choices: eventTypes,
      description: 'Stop after writing the first selected event of this type',
    },
    timeout: {
      type: 'number',
      valueName: 'duration',
      description: 'Set an overall deadline, e.g. 30s or 2m (minimum: 250ms; default: unlimited)',
    },
  },
  render: {
    examples: [
      'opencove events --count 1 --fields snapshot.state',
      '{"version":1,"type":"agent.state_changed","cursor":"...","snapshot":{"state":"idle"}}',
    ],
    fields: [
      'version',
      'type',
      'cursor',
      'epoch',
      'seq',
      'projectId',
      'spaceId',
      'snapshot',
      'snapshot.nodeId',
      'snapshot.sessionId',
      'snapshot.provider',
      'snapshot.lastTransitionAt',
      'snapshot.state',
      'snapshot.quality',
      'snapshot.turn',
      'snapshot.turn.id',
      'snapshot.turn.startedAt',
      'snapshot.turn.start',
      'snapshot.turnOutcome',
      'snapshot.lastEndedTurn',
      'snapshot.lastEndedTurn.id',
      'snapshot.lastEndedTurn.outcome',
      'snapshot.lastEndedTurn.endedAt',
      'snapshot.blockedReason',
      'snapshot.blockedSummary',
      'snapshot.blockedSummary.kind',
      'snapshot.blockedSummary.questions',
      'snapshot.source',
      'endedTurn',
      'endedTurn.id',
      'endedTurn.startedAt',
      'endedTurn.start',
      'spawnedBy',
      'lineageDepth',
      'lineageStatus',
    ],
  },
  validateBeforeConnect({ options: o }) {
    if (o.after !== undefined) {
      try {
        decodeEventCursor(String(o.after))
      } catch {
        usage('Invalid event cursor. Use a complete cursor printed by opencove events.')
      }
    }
    if (o.pretty || o.output === 'table' || o.limit !== undefined) {
      usage(
        'Events require compact NDJSON. Omit --pretty, table output and --limit; use --count to stop.',
      )
    }
    if (o.count !== undefined && (!Number.isSafeInteger(o.count) || Number(o.count) < 1)) {
      usage('--count must be a positive safe integer.')
    }
    if (
      o.timeout !== undefined &&
      (!Number.isSafeInteger(o.timeout) ||
        Number(o.timeout) < 250 ||
        Number(o.timeout) > 2147483647)
    ) {
      usage('--timeout must be whole milliseconds from 250 to 2147483647.')
    }
    if (o.until && !((o.type ?? eventTypes) as readonly string[]).includes(String(o.until))) {
      usage('--until must belong to the selected --type set.')
    }
  },
  examples: [
    'opencove events --space "Main" --until agent.turn_completed --timeout 2m',
    'opencove events --spawned-by @self --count 10',
    'opencove events --after saved-cursor',
  ],
  execute: runEvents,
})
