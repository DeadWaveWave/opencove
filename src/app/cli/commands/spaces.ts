import type { CreateChildSpaceResult } from '../../../shared/contracts/dto'
import type { CreateSpaceResult } from '../../../shared/contracts/dto/workspaceBootstrap'
import { defineCommand, type Command, type CommandArgs, type CommandContext } from '../core/command'
import { resolveCurrentContainer } from '../core/currentContainer'
import { CliError, usage } from '../core/errors'
import { resolveSelectors } from '../core/selectors'
import { declaredOutput } from './declaredOutput'

const rectKeys = ['x', 'y', 'width', 'height'] as const

function spaceInput({ options: o }: CommandArgs) {
  if (typeof o.name !== 'string' || !o.name.trim()) {
    usage('--name must not be blank')
  }
  if (o.in === undefined) {
    if (o.move !== undefined) {
      usage(
        '--move requires --in <space selector>; moving root-canvas nodes into a new top-level space is not supported',
      )
    }
    if (o.frame !== undefined) {
      usage('--frame requires --in <space selector>; top-level spaces are placed automatically')
    }
    return { projectId: o.project, name: o.name, directoryPath: o.directory }
  }
  if (o.directory !== undefined) {
    usage('--directory cannot be used with --in; child spaces inherit their parent directory')
  }
  if (o.frame !== undefined) {
    const frame = o.frame as Record<string, unknown> | null
    if (
      !frame ||
      typeof frame !== 'object' ||
      Array.isArray(frame) ||
      rectKeys.some(key => typeof frame[key] !== 'number' || !Number.isFinite(frame[key])) ||
      Number(frame.width) <= 0 ||
      Number(frame.height) <= 0 ||
      Object.keys(frame).some(key => !rectKeys.includes(key as (typeof rectKeys)[number]))
    ) {
      usage('--frame must be a JSON object with finite x, y and positive width and height')
    }
  }
  return {
    parentSpaceId: o.in,
    projectId: o.project,
    name: o.name,
    rect: o.frame,
    initialNodeIds: o.move ? [...new Set(o.move as string[])] : undefined,
  }
}

// Adapt public --in/--move names to the shared selector resolver without adding aliases to core.
const childTargets: Command = defineCommand({
  path: ['space', 'create'],
  summary: 'Resolve child space targets',
  connect: true,
  options: {
    space: { type: 'string', description: 'Parent space', defaultSelf: false },
    node: { type: 'string', description: 'Nodes to move', multiple: true, defaultSelf: false },
    project: { type: 'string', description: 'Project', defaultSelf: false },
  },
})

async function resolveParent(ctx: CommandContext) {
  const args: CommandArgs = {
    positionals: [],
    options: { space: ctx.options.in, node: ctx.options.move, project: ctx.options.project },
    explicitOptions: new Set([
      'space',
      ...(ctx.explicitOptions?.has('project') ? ['project'] : []),
      ...(ctx.options.move ? ['node'] : []),
    ]),
  }
  try {
    await resolveSelectors(childTargets, args, ctx.io, ctx.invoke)
  } catch (error) {
    if (error instanceof CliError) {
      if (
        ctx.options.in === '@self' &&
        error.code === 'cli.usage' &&
        error.message === 'This OpenCove terminal does not belong to a space.'
      ) {
        throw new CliError(
          error.code,
          error.exitCode,
          error.message,
          'Choose a parent with --in <space selector>. To create a top-level space instead, omit --in, --move and --frame.',
          error.details,
        )
      }
      if (error.code === 'node.not_found') {
        throw new CliError(
          error.code,
          error.exitCode,
          error.message,
          'Choose nodes that belong directly to the parent selected with --in. Remove the mismatched --move option or select that node’s parent with --in.',
          error.details,
        )
      }
    }
    throw error
  }
  return spaceInput({
    ...args,
    options: { ...ctx.options, in: args.options.space, move: args.options.node },
  })
}

async function currentProject(ctx: CommandContext) {
  let io = ctx.io
  if (io.env.OPENCOVE_ENV !== '1' || !io.env.OPENCOVE_NODE_ID) {
    const caller = await ctx.whoami()
    if (caller.caller !== 'session-grant' || !caller.nodeId) {
      usage('Creating a top-level space requires --project <selector> outside an OpenCove terminal')
    }
    io = { ...io, env: { ...io.env, OPENCOVE_ENV: '1' } }
  }
  const args: CommandArgs = { options: {}, positionals: [] }
  await resolveCurrentContainer(
    { ...spaceCreateCommand, currentContainer: true },
    args,
    io,
    ctx.invoke,
    ctx.self,
  )
  return args.options.project
}

export const spaceCreateCommand = defineCommand({
  path: ['space', 'create'],
  summary: 'Create a top-level or child space',
  usage:
    '--name <name> [--project <selector>] [--directory <path>] | --name <name> --in <selector> [--frame <json>] [--move <selector>]...',
  description:
    'Top-level spaces use your terminal node’s current project unless --project is given; outside OpenCove, supply --project. Placement is automatic. --directory must be an existing absolute local directory within the project’s default mount; symlinks cannot escape that mount. Omit it to use the mount root.\n\nWith --in, create a child space in the selected parent and inherit its directory. --move selects direct members of that parent. Without --frame, the boundary encloses the moved nodes, or defaults to 420×300 at the parent’s center. The server fits the boundary inside the parent, preserves room for moved nodes, and grows ancestors when needed. The result reports rect as {x,y,width,height} in canvas coordinates.',
  connect: true,
  operation: 'space.create',
  operationAliases: ['space.createChild'],
  selectOperation: ({ options }) =>
    options.in === undefined ? 'space.create' : 'space.createChild',
  // Defaults and --in/--move resolve after connection; the server validates the final payload.
  serverValidation: true,
  options: {
    name: { type: 'string', valueName: 'name', description: 'Name the new space', required: true },
    project: {
      type: 'string',
      valueName: 'selector',
      description: 'Select the project, or narrow the parent lookup',
      defaultSelf: false,
    },
    directory: {
      type: 'string',
      valueName: 'path',
      description: 'Set a top-level space’s working directory',
    },
    in: {
      type: 'string',
      valueName: 'selector',
      description:
        'Create inside a parent space; accepts @self, an exact ID, exact name or unique ID prefix (6+ characters)',
    },
    frame: {
      type: 'json',
      valueName: 'json',
      description: 'Set the child boundary: {"x":0,"y":0,"width":420,"height":300}; requires --in',
    },
    move: {
      type: 'string',
      valueName: 'selector',
      multiple: true,
      description:
        'Move a node from the parent; repeat for more nodes. Accepts @self, @parent, an exact ID, exact name or unique ID prefix (6+ characters); requires --in',
    },
  },
  render: declaredOutput(
    [
      'id',
      'name',
      'projectId',
      'parentSpaceId',
      'rect',
      'rect.x',
      'rect.y',
      'rect.width',
      'rect.height',
      'directoryPath',
      'movedNodeIds',
    ],
    { id: 'space-123' },
  ),
  examples: [
    'opencove space create --name "Review"',
    'opencove space create --name "Migration" --project project-123 --directory /workspace/migration',
    'opencove space create --name "Review notes" --in @self --move "Brief" --move "Checklist"',
  ],
  validateBeforeConnect({ options: o }, env) {
    if (
      o.in === undefined &&
      o.project === undefined &&
      !(env.OPENCOVE_ENV === '1' && env.OPENCOVE_NODE_ID) &&
      !o.token &&
      !env.OPENCOVE_CONTROL_TOKEN
    ) {
      usage('Creating a top-level space requires --project <selector> outside an OpenCove terminal')
    }
  },
  buildInput: spaceInput,
  async execute(ctx) {
    if (ctx.options.in === undefined) {
      const input = {
        ...(ctx.input as object),
        projectId: ctx.options.project ?? (await currentProject(ctx)),
      }
      const result = (await ctx.invoke('space.create', input)) as CreateSpaceResult
      return spaceOutput(result.projectId, result.space, [])
    }
    const input = await resolveParent(ctx)
    let result: CreateChildSpaceResult
    try {
      result = (await ctx.invoke('space.createChild', input)) as CreateChildSpaceResult
    } catch (error) {
      if (error instanceof CliError && error.code === 'common.invalid_input') {
        const messages: Record<string, string> = {
          nodes_not_in_parent:
            'Every node selected with --move must belong directly to the parent space selected with --in.',
          parent_missing_rect:
            'The selected parent space has no canvas boundary. Open it in OpenCove before creating a child space.',
          invalid_rect:
            'The child space boundary is invalid. Supply --frame with finite x, y and positive width and height.',
        }
        const reason = Object.keys(messages).find(key =>
          error.message.endsWith(`space.createChild failed: ${key}`),
        )
        if (reason) {
          throw new CliError(error.code, error.exitCode, messages[reason], undefined, error.details)
        }
      }
      throw error
    }
    const requested = ctx.options.frame as Record<string, number> | undefined
    if (requested && rectKeys.some(key => requested[key] !== result.childSpace.rect?.[key])) {
      ctx.io.stderr.write(
        `Notice: space frame adjusted; applied rect: ${JSON.stringify(result.childSpace.rect)}.\n`,
      )
    }
    return spaceOutput(result.projectId, result.childSpace, result.movedNodeIds)
  },
})

function spaceOutput(projectId: string, space: CreateSpaceResult['space'], movedNodeIds: string[]) {
  if (!space) {
    throw new CliError(
      'cli.result_unavailable',
      1,
      'The space was created, but this Worker did not return its details.',
      'Run "opencove space list" to find it. Do not repeat the creation command.',
    )
  }
  return {
    id: space.id,
    name: space.name,
    projectId,
    parentSpaceId: space.parentSpaceId ?? null,
    rect: space.rect,
    directoryPath: space.directoryPath,
    movedNodeIds,
  }
}
