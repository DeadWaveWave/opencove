import {
  prepareAgentBatch,
  recoverAgentBatchPreflight,
  createAgentBatch,
  agentBatchExitCode,
  agentBatchText,
  agentBatchOutput,
} from './nodeCreateAgentBatch'
import { NODE_MIN_SIZE_BY_KIND } from '../../../shared/types/nodeSizeLimits'
import { hasNodeFrameCoordinates, NODE_NEAR_FRAME_ERROR } from '../../../shared/utils/nodeNearFrame'
import { mutateNode } from './nodeMutation'
import { INITIAL_PROMPT_RULES_TEXT } from '../../../shared/errors/initialPromptRules'
import { validateTurnWaitOptions } from '../core/agentTurnComposition'
import { spawnedByOption } from '../core/nodeLineage'
import { kindWithArticle } from '../core/kindWording'
import { nodeAgentMetadata } from '../core/agentMetadata'
import type { ListNodesResult } from '../../../shared/contracts/dto/nodeControl'
import { nodeDeleteOutput, canvasFocusOutput } from './outputContracts'
import {
  nodeListOutput,
  nodeGetOutput,
  nodeKindOutput,
  createdAgentWaitOutput,
} from './outputContracts'
import { defineCommand, type CommandArgs, type OptionSpec } from '../core/command'
import { usage } from '../core/errors'
import { AGENT_PROVIDER_IDS } from '../../../shared/contracts/dto'
const nodeContentHelp =
  'Content by kind: note → data.text; task → data.requirement, data.status, data.priority, data.tags; website → data.url; agent/terminal → status, sessionId. node list returns summaries: use node get for full note text and other content. A requested field absent on a returned kind produces one stderr notice; stdout remains projected JSON.'
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
  Provider: [
    'id',
    `Select the agent provider. Accepted IDs: ${AGENT_PROVIDER_IDS.join(', ')}; omit to use the configured default`,
  ],
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
    return {
      prompt: o.prompt ?? '',
      provider: o.provider,
      model: o.model,
      ...(o.task === undefined ? {} : { taskNodeId: o.task }),
      ...(o['full-access'] === undefined ? {} : { agentFullAccess: o['full-access'] === 'true' }),
    }
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
const rootCanvasOption: OptionSpec = {
  type: 'boolean',
  description: "Create on the project's root canvas, outside every Space",
  conflicts: ['space', 'space-name', 'worker', 'branch', 'path'],
}
const nodeLocatorOptions: Record<string, OptionSpec> = {
  ...locatorOptions,
  space: { ...locatorOptions.space, defaultSelfUnless: ['root-canvas', 'spawned-by'] },
  'root-canvas': rootCanvasOption,
}
const kinds = ['note', 'task', 'website', 'agent', 'terminal'] as const
export const nodeCommands = [
  defineCommand({
    path: ['node', 'list'],
    summary: 'List canvas nodes',
    description:
      nodeContentHelp +
      '\n\n' +
      'Lists per-kind summaries: data carries kind plus requirement, status, priority and tags for tasks, or url for websites; data carries only kind for notes, agents and terminals. Read full content, such as note text, with "opencove node get --node <id>".\n\ndata.status is task status. Top-level status is session lifecycle (for example running or exited) for agents and terminals, not whether an agent is idle or working. STATE shows task status or session lifecycle; agentState is the separate work-state field. sessionStatus aliases lifecycle status. agentState {state, quality, turnId} reports work for agents and observed agents in terminals; state working means the agent is working. Missing observations are unknown/degraded. context keeps its legacy state field.',
    targetSpace: 'optional',
    currentContainer: true,
    connect: true,
    operation: 'node.list',
    options: {
      ...nodeLocatorOptions,
      'root-canvas': {
        ...rootCanvasOption,
        description: "List only nodes on the project's root canvas, outside every Space",
      },
      kind: { ...stringOption('Node kind'), inputPath: 'kind' },
      'spawned-by': spawnedByOption,
    },
    buildInput: ({ options: o }) => ({
      space: locator(o),
      projectId: o.project,
      kind: o.kind,
      spawnedByNodeId: o['spawned-by'],
    }),
    render: nodeListOutput,
    async execute(ctx) {
      const result = (await ctx.invoke('node.list', ctx.input)) as ListNodesResult
      const nodes = ctx.options['root-canvas']
        ? result.nodes.filter(node => node.spaceId === null)
        : result.nodes
      return { ...result, nodes: await nodeAgentMetadata(nodes, ctx, result) }
    },
  }),
  ...(['get', 'delete'] as const).map(action =>
    defineCommand({
      path: ['node', action],
      summary: `${action === 'get' ? 'Get' : 'Delete'} a canvas node`,
      connect: true,
      operation: `node.${action}`,
      render: action === 'get' ? nodeGetOutput : nodeDeleteOutput,
      description: action === 'get' ? nodeContentHelp : undefined,
      options: { node: stringOption('Node ID', true) },
      buildInput: ({ options: o }) => ({ nodeId: o.node }),
    }),
  ),
  ...(['create', 'update'] as const).flatMap(action =>
    kinds.map(kind => {
      const create = action === 'create'
      const specific: Record<string, OptionSpec> =
        !create && (kind === 'agent' || kind === 'terminal')
          ? {}
          : kind === 'note'
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
                      'prompts-file': {
                        type: 'string',
                        valueName: 'path',
                        description:
                          'Launch 1–10 prompts from a JSON file or stdin; requires --wait',
                        conflicts: [
                          'prompt',
                          'prompt-file',
                          'title',
                          'task',
                          'frame',
                          'quiet',
                          'fields',
                          'focus',
                          'limit',
                        ],
                      },
                      wait: {
                        type: 'boolean',
                        description: 'Wait for the initial prompt turn to end',
                      },
                      read: {
                        type: 'boolean',
                        description: 'Include the exact initial turn reply; requires --wait',
                      },
                      timeout: {
                        type: 'number',
                        valueName: 'duration',
                        description:
                          'First-turn identification and wait budget (default 20s; minimum 250ms)',
                      },
                      provider: stringOption('Provider'),
                      model: stringOption('Model'),
                      task: {
                        type: 'string',
                        valueName: 'nodeId',
                        description:
                          'Link to an existing task in the same Space and move it to doing',
                      },
                      'full-access': {
                        type: 'string',
                        valueName: 'true|false',
                        choices: ['true', 'false'],
                        description:
                          'Set Full Access for this agent and its restarts; omit to follow Settings',
                      },
                    }
                  : {
                      shell: stringOption('Shell'),
                      command: stringOption('Command'),
                      profile: stringOption('Profile'),
                    }
      return defineCommand({
        path: ['node', action, kind],
        summary: `${create ? 'Create' : 'Update'} ${kindWithArticle(kind)} node`,
        description: create
          ? (kind === 'agent'
              ? INITIAL_PROMPT_RULES_TEXT +
                '\n\nUse --prompt or --prompt-file with --wait to collect the initial Claude Code or Codex turn. Add --read for its exact reply. Check outcome: every ended outcome exits 0; unavailable replies return reply: null with replyUnavailableReason. Waiting for the user exits 10, an exited target 11, timeout 124 and interruption 130. Unsupported providers refuse after creation; the node remains.\n\nFor several agents, use --prompts-file <path|-> --wait [--read]: a UTF-8 JSON array of 1–10 objects with a nonblank prompt and optional title, at most 1 MiB. All entries are validated before launch. Conflicts: --prompt, --prompt-file, --title, --task, --frame, -q, --fields, --focus and --limit. Target, provider, model and Full Access choices apply to every entry. Add --near @self to place each entry near you; each create finds its own free slot. Creates run in input order; waits run concurrently. Each result or error is retained in an ordered JSON array: {index, title, ok, exitCode, result|error}. index starts at 0; error is the ordinary error envelope. Exit is the first nonzero entry exit; Ctrl-C overrides with 130. Later entries are still attempted after a failure; no launch is retried.\n\n--timeout covers identification and waiting per agent from its creation response (default 20s; minimum 250ms); creation has its own 20s budget. Stderr prints created node/session IDs, then an exact-turn continuation. Errors retain known IDs. Missing telemetry does not prove the agent has stopped. Never repeat creation or resend: inspect the existing session and resume agent wait/read. Ctrl-C stops dispatch and observation, leaves agents running and prints every entry. With a single prompt, -q prints the ID after completion. See opencove skill coordinate for recovery.\n\n'
              : '') +
            'For agents creating helper nodes, recommend --near @self to place them near the caller in its current Space (or root). --near is opt-in; combine with --root-canvas to place outside Spaces. Size-only --frame (width/height) is allowed with --near; x/y are refused.\n\nWithout explicit x/y, root-canvas placement searches next to you when run inside OpenCove and avoids Spaces. If your node belongs to another project, the search starts at the canvas origin. Use --focus to reveal the node. A --frame with both x and y places the node exactly there, even if it overlaps a Space.'
          : kind === 'agent' || kind === 'terminal'
            ? 'Rename this window and keep its name when the agent session changes. The name is saved as provided, with surrounding whitespace removed. Use --frame to also move or resize it.'
            : undefined,
        targetSpace: create ? 'required' : undefined,
        currentContainer: create,
        connect: true,
        quietIdPath: create ? 'node.id' : undefined,
        operation: `node.${action}`,
        render: nodeKindOutput(kind, create),
        selectRender:
          create && kind === 'agent'
            ? ({ options }) =>
                options['prompts-file'] !== undefined
                  ? { list: true }
                  : options.wait
                    ? createdAgentWaitOutput()
                    : nodeKindOutput(kind, create)
            : undefined,
        operationCommand: `opencove node ${action}`,
        ...(create && kind === 'agent'
          ? {
              prepare: prepareAgentBatch,
              recoverPreflight: recoverAgentBatchPreflight,
              exitCode: agentBatchExitCode,
              outputValue: agentBatchOutput,
              textOutput: agentBatchText,
            }
          : {}),
        options: {
          ...specific,
          ...(create ? nodeLocatorOptions : { node: stringOption('Node ID', true) }),
          title: {
            ...stringOption('Title'),
            ...(kind === 'agent' || kind === 'terminal'
              ? {
                  description: 'Set a fixed window name; omit on creation to keep automatic titles',
                }
              : {}),
          },
          frame: {
            type: 'json',
            description: `Set x, y, width and height as a JSON object. Sizes below a kind's minimum are raised; ${kind} minimum: width ${NODE_MIN_SIZE_BY_KIND[kind].width}, height ${NODE_MIN_SIZE_BY_KIND[kind].height}; inspect appliedFrame and frameAdjusted for the actual applied size`,
            valueName: 'json',
          },
          ...(create
            ? {
                near: {
                  type: 'string' as const,
                  selector: 'node' as const,
                  valueName: 'selector',
                  description:
                    'Place near a reference node; recommend --near @self for helper nodes',
                },
                focus: { type: 'boolean' as const, description: 'Focus after creation' },
              }
            : {}),
        },
        examples:
          create && kind === 'note'
            ? [
                'opencove node create note --space space-123 --title "Release checklist" --text "Run the smoke tests"',
                'opencove node create note --root-canvas --project project-123 --text "Canvas note" --focus',
                'opencove node create note --space-name "Sprint planning" --project project-123 --text-file ./notes.md --focus',
                "printf 'Review the release notes\\n' | opencove node create note --space space-123 --text-file -",
              ]
            : [
                `opencove node ${action} ${kind} ${create ? '--space space-123' : '--node node-123'}${kind === 'task' ? ' --requirement "Review release notes"' : kind === 'website' ? ' --url https://example.com' : kind === 'note' ? ' --text "Updated note"' : kind === 'agent' && create ? ' --prompt "Review the test failures" --wait --read --timeout 2m' : !create && (kind === 'agent' || kind === 'terminal') ? ' --title "Lead"' : ''}`,
                `opencove node ${action} ${kind} ${create ? '--root-canvas --project project-123' : '--node node-123'}${kind === 'task' ? ' --requirement "Review release notes"' : kind === 'website' ? ' --url https://example.com' : ''} --title "Release review" --pretty`,
              ],
        buildInput: ({ options: o }: CommandArgs) => {
          if (
            o.frame !== undefined &&
            (!o.frame || typeof o.frame !== 'object' || Array.isArray(o.frame))
          ) {
            usage('--frame must be a JSON object')
          }
          if (create && o.near !== undefined && hasNodeFrameCoordinates(o.frame)) {
            usage(NODE_NEAR_FRAME_ERROR)
          }
          if (create && kind === 'agent') {
            validateTurnWaitOptions(o)
            if (
              o.wait &&
              o['prompts-file'] === undefined &&
              (typeof o.prompt !== 'string' || !o.prompt.trim())
            ) {
              usage(
                '--wait requires an initial prompt: start it with --prompt, or send one later with agent prompt --wait.',
              )
            }
          }
          const targetSpace = create ? locator(o) : undefined
          return {
            kind,
            ...(create
              ? targetSpace
                ? { space: targetSpace }
                : { projectId: o.project }
              : { nodeId: o.node }),
            ...(create && o.near !== undefined
              ? {
                  near: {
                    nodeId: o.near,
                    target: o['root-canvas'] ? 'root-canvas' : 'reference-container',
                  },
                  ...(o.project !== undefined ? { projectId: o.project } : {}),
                }
              : {}),
            title: o.title,
            frame: o.frame,
            ...(create || (kind !== 'agent' && kind !== 'terminal')
              ? { data: data(kind, o, create) }
              : {}),
          }
        },
        execute: ctx =>
          create && kind === 'agent' && ctx.options['prompts-file'] !== undefined
            ? createAgentBatch(ctx)
            : mutateNode(ctx, kind, create),
      })
    }),
  ),
  ...(['node', 'space'] as const).map(kind =>
    defineCommand({
      path: ['canvas', 'focus', kind],
      summary: `Focus ${kindWithArticle(kind)}`,
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
