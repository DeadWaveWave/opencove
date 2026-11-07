import { nodeDeleteOutput, canvasFocusOutput } from './outputContracts'
import { nodeListOutput, nodeGetOutput, nodeKindOutput } from './outputContracts'
import { defineCommand, type CommandArgs, type OptionSpec } from '../core/command'
import { CliError, usage } from '../core/errors'
import { AGENT_PROVIDER_IDS } from '../../../shared/contracts/dto'
const optionChoices: Record<string, readonly string[]> = {
  'Node kind': [
    'note',
    'task',
    'website',
    'agent',
    'terminal',
    'plugin',
    'document',
    'folder',
    'image',
    'role',
  ],
  Priority: ['low', 'medium', 'high', 'urgent'],
  Status: ['todo', 'doing', 'ai_done', 'done'],
  'Session mode': ['shared', 'incognito', 'profile'],
  Provider: [...AGENT_PROVIDER_IDS, ''],
}
const optionText: Record<string, [string, string]> = {
  'Node ID': ['id', 'Select a canvas node by its ID'],
  'Node kind': [
    'kind',
    'Filter by note, task, website, agent, terminal, plugin, document, folder, image or role',
  ],
  'Note text': ['text', 'Set the note contents'],
  Requirement: ['text', 'Describe the task requirement'],
  Priority: ['low|medium|high|urgent', 'Set the task priority'],
  Tag: ['tag', 'Add a task tag; repeat to add more'],
  Status: ['todo|doing|ai_done|done', 'Set the task status'],
  URL: ['url', 'Set the website address'],
  'Session mode': ['shared|incognito|profile', 'Choose the browser session mode'],
  Profile: ['id', 'Select a browser or terminal profile'],
  'Agent prompt': ['text', 'Set the initial agent prompt'],
  Provider: ['id', 'Select the agent provider'],
  Model: ['id', 'Select the agent model'],
  Shell: ['path', 'Choose the terminal shell executable'],
  Command: ['command', 'Run this command in the terminal'],
  Title: ['text', 'Set the node title'],
  'Project ID': ['id', 'Filter by project ID'],
  'Space ID': ['id', 'Select a space by its ID'],
}
export const stringOption = (description: string, required = false): OptionSpec => ({
  type: 'string',
  description: optionText[description]?.[1] ?? description,
  valueName: optionText[description]?.[0] ?? description.toLowerCase().replaceAll(' ', '-'),
  required,
  choices: optionChoices[description],
})
const locatorOptions: Record<string, OptionSpec> = {
  space: { ...stringOption('Space ID') },
  'space-name': { type: 'string', valueName: 'name', description: 'Find a space by its name' },
  worker: {
    type: 'string',
    valueName: 'id-or-name',
    description: 'Select the worker that owns the space',
  },
  branch: { type: 'string', valueName: 'branch', description: 'Match the space by Git branch' },
  path: {
    type: 'string',
    valueName: 'absolute-path',
    description: 'Match the space by working directory',
  },
  project: { ...stringOption('Project ID') },
}
function locator(o: Record<string, unknown>, required = false) {
  const modes = [o.space, o['space-name'], o.worker && o.branch, o.worker && o.path].filter(
    v => v !== undefined && v !== false,
  ).length
  if (modes > 1 || (o.worker && !o.branch && !o.path) || (!o.worker && (o.branch || o.path))) {
    usage(
      `Conflicting space locator flags: ${['space', 'space-name', 'worker', 'branch', 'path']
        .filter(key => o[key] !== undefined)
        .map(key => '--' + key)
        .join(', ')}`,
      'Choose exactly one space locator mode.',
    )
  }
  if (!modes) {
    if (required) {
      usage('Missing space locator')
    }
    return undefined
  }
  if (o.space !== undefined) {
    return { kind: 'spaceId', spaceId: o.space }
  }
  if (o['space-name'] !== undefined) {
    return { kind: 'spaceName', name: o['space-name'], projectId: o.project }
  }
  return {
    kind: o.branch !== undefined ? 'workerBranch' : 'workerPath',
    worker: o.worker,
    ...(o.branch !== undefined ? { branch: o.branch } : { path: o.path }),
    projectId: o.project,
  }
}
function data(kind: string, o: Record<string, unknown>, create: boolean) {
  if (kind === 'note') {
    return { text: o.text ?? (create ? '' : undefined) }
  }
  if (kind === 'task') {
    return {
      requirement: o.requirement,
      priority: o.priority ?? (create ? 'medium' : undefined),
      tags: o['clear-tags'] ? [] : (o.tag ?? (create ? [] : undefined)),
      status: o.status,
    }
  }
  if (kind === 'agent') {
    return { prompt: o.prompt ?? '', provider: o.provider, model: o.model }
  }
  if (kind === 'terminal') {
    return { shell: o.shell, command: o.command, profileId: o.profile }
  }
  return {
    url: o.url,
    pinned: create ? !!o.pinned : o.pinned === undefined ? undefined : o.pinned === 'true',
    sessionMode: o['session-mode'] ?? (create ? 'shared' : undefined),
    profileId: o.profile,
  }
}
const kinds = ['note', 'task', 'website', 'agent', 'terminal']
export const nodeCommands = [
  defineCommand({
    path: ['node', 'list'],
    summary: 'List canvas nodes',
    description:
      'Lists per-kind summaries: data carries kind plus requirement, status, priority and tags for tasks, or url for websites; data carries only kind for notes, agents and terminals. Read full content, such as note text, with "opencove node get --node <id>".\n\ndata.status is task status. Top-level status is session lifecycle (for example running or exited) for agents and terminals, not whether an agent is idle or working. STATE shows task status or session lifecycle. Use "opencove agent list" or "opencove agent get --node <selector>" for agent run state; context exposes it as state and keeps lifecycle as sessionStatus.',
    targetSpace: 'optional',
    connect: true,
    operation: 'node.list',
    options: { ...locatorOptions, kind: { ...stringOption('Node kind'), inputPath: 'kind' } },
    buildInput: ({ options: o }) => ({ space: locator(o), projectId: o.project, kind: o.kind }),
    render: nodeListOutput,
  }),
  ...(['get', 'delete'] as const).map(action =>
    defineCommand({
      path: ['node', action],
      summary: `${action === 'get' ? 'Get' : 'Delete'} a canvas node`,
      connect: true,
      operation: `node.${action}`,
      render: action === 'get' ? nodeGetOutput : nodeDeleteOutput,
      description:
        action === 'get'
          ? 'data.status is task status; top-level status is agent or terminal runtime status.'
          : undefined,
      options: { node: stringOption('Node ID', true) },
      buildInput: ({ options: o }) => ({ nodeId: o.node }),
    }),
  ),
  ...(['create', 'update'] as const).flatMap(action =>
    (action === 'create' ? kinds : kinds.slice(0, 3)).map(kind => {
      const create = action === 'create'
      const specific: Record<string, OptionSpec> =
        kind === 'note'
          ? { text: { ...stringOption('Note text'), fileVariant: true } }
          : kind === 'task'
            ? {
                requirement: stringOption('Requirement', create),
                priority: stringOption('Priority'),
                tag: {
                  ...stringOption('Tag'),
                  description: create
                    ? 'Set task tags; repeat for each tag'
                    : 'Replace all tags; repeat for each tag in the new list',
                  multiple: true,
                },
                ...(!create
                  ? {
                      'clear-tags': {
                        type: 'boolean' as const,
                        description: 'Remove all task tags',
                        conflicts: ['tag'],
                      },
                    }
                  : {}),
                ...(!create ? { status: stringOption('Status') } : {}),
              }
            : kind === 'website'
              ? {
                  url: stringOption('URL', create),
                  pinned: {
                    type: create ? 'boolean' : 'string',
                    description: 'Keep the website pinned',
                    valueName: 'true|false',
                    ...(!create ? { choices: ['true', 'false'] } : {}),
                  },
                  'session-mode': stringOption('Session mode'),
                  profile: stringOption('Profile'),
                }
              : kind === 'agent'
                ? {
                    prompt: { ...stringOption('Agent prompt'), fileVariant: true },
                    provider: stringOption('Provider'),
                    model: stringOption('Model'),
                  }
                : {
                    shell: stringOption('Shell'),
                    command: stringOption('Command'),
                    profile: stringOption('Profile'),
                  }
      return defineCommand({
        path: ['node', action, kind],
        summary: `${create ? 'Create' : 'Update'} a ${kind} node`,
        targetSpace: create ? 'required' : undefined,
        connect: true,
        operation: `node.${action}`,
        render: nodeKindOutput(kind, create),
        operationCommand: `opencove node ${action}`,
        options: {
          ...specific,
          ...(create ? locatorOptions : { node: stringOption('Node ID', true) }),
          title: stringOption('Title'),
          frame: {
            type: 'json',
            description: 'Set x, y, width and height as a JSON object',
            valueName: 'json',
          },
          ...(create
            ? { focus: { type: 'boolean' as const, description: 'Focus after creation' } }
            : {}),
        },
        examples:
          create && kind === 'note'
            ? [
                'opencove node create note --space space-123 --title "Release checklist" --text "Run the smoke tests"',
                'opencove node create note --space-name "Sprint planning" --project project-123 --text-file ./notes.md --focus',
                "printf 'Review the release notes\\n' | opencove node create note --space space-123 --text-file -",
              ]
            : [
                `opencove node ${action} ${kind} ${create ? '--space space-123' : '--node node-123'}${kind === 'task' ? ' --requirement "Review release notes"' : kind === 'website' ? ' --url https://example.com' : kind === 'note' ? ' --text "Updated note"' : kind === 'agent' ? ' --prompt "Review the test failures"' : ''}`,
                `opencove node ${action} ${kind} ${create ? '--space space-123' : '--node node-123'}${kind === 'task' ? ' --requirement "Review release notes"' : kind === 'website' ? ' --url https://example.com' : ''} --title "Release review" --pretty`,
              ],
        buildInput: ({ options: o }: CommandArgs) => {
          if (
            o.frame !== undefined &&
            (!o.frame || typeof o.frame !== 'object' || Array.isArray(o.frame))
          ) {
            usage('--frame must be a JSON object')
          }
          return {
            kind,
            ...(create ? { space: locator(o, true) } : { nodeId: o.node }),
            title: o.title,
            frame: o.frame,
            data: data(kind, o, create),
          }
        },
        ...(create
          ? {
              async execute(ctx) {
                const value = await ctx.invoke('node.create', ctx.input)
                if (!ctx.options.focus) {
                  return value
                }
                const created = value as { node: { id: string } }
                try {
                  return {
                    ...(value as object),
                    focus: await ctx.invoke('canvas.focus', {
                      target: { kind: 'node', nodeId: created.node.id },
                    }),
                    focusError: null,
                  }
                } catch (error) {
                  if (!(error instanceof CliError) || error.exitCode !== 1) {
                    throw error
                  }
                  return {
                    ...(value as object),
                    focus: null,
                    focusError: { code: error.code, debugMessage: error.message },
                  }
                }
              },
            }
          : {}),
      })
    }),
  ),
  ...(['node', 'space'] as const).map(kind =>
    defineCommand({
      path: ['canvas', 'focus', kind],
      summary: `Focus a ${kind}`,
      targetSpace: kind === 'space' ? 'required' : undefined,
      connect: true,
      operation: 'canvas.focus',
      render: canvasFocusOutput(kind),
      options: kind === 'node' ? { node: stringOption('Node ID', true) } : locatorOptions,
      buildInput: ({ options: o }) => ({
        target: kind === 'node' ? { kind, nodeId: o.node } : { kind, locator: locator(o, true) },
      }),
    }),
  ),
]
