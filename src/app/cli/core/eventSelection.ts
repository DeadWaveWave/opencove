import type { CommandContext, Command } from './command'
import { usage } from './errors'
import { resolveSelectors } from './selectors'
import {
  canonicalSelection,
  decodeEventCursor,
  type EventSelection,
} from '../../../shared/contracts/dto/eventStream'

const selectionKeys = {
  type: 'types',
  project: 'projectId',
  space: 'spaceId',
  node: 'nodeId',
  'spawned-by': 'spawnedBy',
  lineage: 'lineage',
} as const
export async function resolveEventSelection(ctx: CommandContext): Promise<EventSelection> {
  let inherited: EventSelection | undefined
  if (ctx.options.after !== undefined) {
    try {
      inherited = decodeEventCursor(String(ctx.options.after)).selection
    } catch {
      usage('Invalid event cursor. Use a complete cursor printed by opencove events.')
    }
  }
  if (
    ctx.options['until-each-turn'] &&
    inherited &&
    !inherited.types.includes('agent.turn_completed')
  ) {
    usage('--until-each-turn requires agent.turn_completed in the cursor’s selected event types.')
  }
  const explicit = [...(ctx.explicitOptions ?? [])].filter(key => key in selectionKeys)
  if (
    (inherited?.spawnedBy && explicit.includes('lineage')) ||
    (inherited?.lineage && explicit.includes('spawned-by'))
  ) {
    usage(
      'The relationship filter differs from the saved cursor. Omit relationship flags to inherit it, or start a fresh stream without --after.',
    )
  }
  const args = {
    options: { ...ctx.options },
    positionals: [],
    explicitOptions: ctx.explicitOptions,
  }
  const command: Command = {
    path: ['events'],
    connect: true,
    summary: '',
    currentContainer: !inherited && !ctx.options.lineage && !ctx.options['until-each-turn'],
    options: {
      project: { type: 'string', selector: 'project', description: '' },
      space: { type: 'string', selector: 'space', description: '' },
      node: { type: 'string', selector: 'node', description: '' },
      'spawned-by': { type: 'string', selector: 'node', description: '' },
      lineage: { type: 'string', selector: 'node', description: '' },
    },
  }
  if (!inherited || explicit.length) {
    await resolveSelectors(command, args, ctx.io, ctx.invoke)
  }
  const nodes = [args.options.node ?? []].flat() as string[]
  ctx.options.resolvedEventNodes = [...new Set(nodes)]
  if (ctx.options['until-each-turn'] || nodes.length > 1) {
    delete args.options.node
  } else if (nodes.length === 1) {
    args.options.node = nodes[0]
  }
  const selection: Partial<EventSelection> = inherited ? { ...inherited } : {}
  for (const [key, field] of Object.entries(selectionKeys)) {
    if ((!inherited || explicit.includes(key)) && args.options[key] !== undefined) {
      Object.assign(selection, { [field]: args.options[key] })
    }
  }
  // Relationship selection suppresses implicit container/project defaults.
  if (
    !inherited &&
    (ctx.options.lineage || ctx.options['spawned-by']) &&
    !ctx.explicitOptions?.has('project')
  ) {
    delete selection.projectId
  }
  if (
    ctx.options['until-each-turn'] &&
    inherited?.nodeId &&
    nodes.some(id => id !== inherited.nodeId)
  ) {
    usage('The cursor selects a different node. Start a fresh stream for these --node targets.')
  }
  const resolved = canonicalSelection(selection)
  if (inherited && JSON.stringify(inherited) !== JSON.stringify(resolved)) {
    usage(
      'The selected filters differ from the saved cursor. Omit selection flags to inherit them, or start a fresh stream without --after.',
    )
  }
  const types = resolved.types
  if (ctx.options.until && !types.includes(ctx.options.until as (typeof types)[number])) {
    usage('--until must belong to the cursor’s selected event types.')
  }
  if (ctx.options['until-each-turn'] && !resolved.types.includes('agent.turn_completed')) {
    usage('--until-each-turn requires agent.turn_completed in the selected event types.')
  }
  return resolved
}
