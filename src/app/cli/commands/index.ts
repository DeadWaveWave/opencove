import { eventsCommand } from './events'
import { spaceUpdateCommand } from './spaceUpdate'
import { spaceCreateCommand } from './spaces'
import { projectAddCommand } from './projects'
import { agentStopCommand } from './agentStop'
import { operationAccessCatalog, operationAccessInfo } from './operationAccessCatalog'
import { agentHistoryClearCommand } from './agentHistory'
import type { GetSpaceResult } from '../../../shared/contracts/dto'
import { agentDeliveryCommand } from './agentDelivery'
import { agentPromptCommand } from './agent'
import { agentQueryCommands } from './agentQueries'
import { skillCommand } from '../skill/command'
import { declaredOutput } from './declaredOutput'
import { identityCommands } from './identity'
import { projectListOutput, spaceListOutput, spaceGetOutput } from './outputContracts'
import { errorTargets } from './errorTargets'
import { lifecycleCommands } from './lifecycle'
import { ptyAttach } from './pty'
import { pluginCommands } from './plugins'
import { remoteCommands } from './remote'
import { filesystemCommands } from './filesystem'
import * as z from 'zod'
import {
  CONTROL_SURFACE_OPERATIONS,
  getControlSurfaceOperation,
} from '../../../shared/contracts/controlSurface/operations'
import { defineCommand, type Command, type CommandContext } from '../core/command'
import { unknownOperation } from '../core/operationErrors'
import { CliError } from '../core/errors'
import { nodeCommands, stringOption } from './nodes'
export const commands: Command[] = [
  eventsCommand,
  spaceCreateCommand,
  spaceUpdateCommand,
  projectAddCommand,
  ...identityCommands,
  agentPromptCommand,
  agentStopCommand,
  agentDeliveryCommand,
  agentHistoryClearCommand,
  ...agentQueryCommands,
  skillCommand,
  ...nodeCommands,
  ...lifecycleCommands,
  ptyAttach,
  ...pluginCommands,
  ...remoteCommands,
  ...filesystemCommands,
  ...(
    [
      ['ping', 'system.ping'],
      ['status', 'system.capabilities'],
    ] as const
  ).map(([name, operation]) =>
    defineCommand({
      path: [name],
      summary:
        name === 'ping'
          ? 'Ping control surface'
          : 'Show protocol, application and instance versions',
      connect: true,
      operation,
      render: {
        examples: [
          `opencove ${name} --fields ${name === 'ping' ? 'ok' : 'protocolVersion'}`,
          name === 'ping' ? '{"ok":true}' : '{"protocolVersion":2}',
        ],
        fields:
          name === 'ping'
            ? ['ok', 'now', 'pid']
            : [
                'ok',
                'now',
                'pid',
                'protocolVersion',
                'appVersion',
                'instanceId',
                'runtimeReady',
                'deploymentId',
                'runtimeBuild',
                'features',
              ],
      },
      buildInput: () => null,
    }),
  ),
  defineCommand({
    path: ['project', 'list'],
    summary: 'List projects',
    connect: true,
    operation: 'project.list',
    buildInput: () => null,
    render: projectListOutput,
  }),
  defineCommand({
    path: ['space', 'list'],
    summary: 'List spaces',
    connect: true,
    operation: 'space.list',
    options: { project: stringOption('Project ID') },
    buildInput: ({ options: o }) => (o.project ? { projectId: o.project } : null),
    render: spaceListOutput,
    description:
      'Lists space IDs, names, directories, nodeIds and nodeCount without full nodes. rect is {x,y,width,height} in canvas coordinates, or null when no geometry is saved. boundary describes the Space’s access scope. Use --fields nodes to include node objects.',
    async execute({ input, invoke, options }) {
      const result = (await invoke(
        'space.list',
        input,
      )) as import('../../../shared/contracts/dto').ListSpacesResult
      const includeNodes = String(options.fields ?? '')
        .split(',')
        .some(field => /^((spaces\.)?nodes)(\.|$)/.test(field.trim()))
      return {
        ...result,
        spaces: result.spaces.map(({ nodes, ...space }) => ({
          ...space,
          ...(result.projectId ? { projectId: result.projectId } : {}),
          nodeCount: space.nodeIds?.length ?? nodes?.length ?? 0,
          ...(includeNodes ? { nodes } : {}),
        })),
      }
    },
  }),
  defineCommand({
    path: ['space', 'get'],
    summary: 'Get a space',
    description:
      'Includes rect: {x,y,width,height} in canvas coordinates, or null when no geometry is saved. boundary describes the Space’s access scope.',
    connect: true,
    operation: 'space.get',
    render: spaceGetOutput,
    options: { space: stringOption('Space ID', true) },
    buildInput: ({ options: o }) => ({ spaceId: o.space }),
    async execute({ invoke, input }) {
      const result = (await invoke('space.get', input)) as GetSpaceResult
      return {
        ...result,
        space: {
          ...result.space,
          projectId: result.projectId,
          nodeCount: result.space.nodeIds?.length ?? result.space.nodes?.length ?? 0,
        },
      }
    },
  }),
  defineCommand({
    path: ['api', 'ops'],
    summary: 'List Control Surface operations with their kind, contract and CLI command',
    get description() {
      return `The full JSON catalog is large (about ${Math.round(Buffer.byteLength(JSON.stringify(operationCatalog())) / 1024)} KB). Start with --domains, then narrow with --prefix or --search and --fields. Each operation includes scope (read, interact or admin); inside OpenCove, access comes from the Worker policy (allowed, denied or constrained). Offline or with an older Worker, access is unknown. The allowed flag is omitted for unknown or constrained access.\n\nWith --domains, output is an array of summaries with these projectable fields:\n  domain: Operation ID prefix before the first dot\n  operations: Total operations in the domain after filtering\n  schema: Operations with a schema input contract\n  commandOperations: Command-kind operations, not dedicated CLI commands`
    },
    connect: false,
    options: {
      domains: {
        type: 'boolean',
        description: 'Count operations, schema contracts and command-kind operations by domain',
      },
      search: {
        type: 'string',
        valueName: 'text',
        description: 'Match operation IDs or summaries, ignoring case',
      },
      prefix: {
        type: 'string',
        valueName: 'domain',
        description: 'Filter by operation domain, such as node or filesystem',
      },
      kind: {
        type: 'string',
        valueName: 'query|command',
        choices: ['query', 'command'],
        description: 'Filter by operation kind',
      },
      contract: {
        type: 'string',
        // @compat control-surface-legacy-validation
        valueName: 'schema|legacy',
        // @compat control-surface-legacy-validation
        choices: ['schema', 'legacy'],
        description: 'Filter by input contract availability',
      },
    },
    async execute({ options: o, io, invoke }) {
      const policy = await readWorkerPolicy({ io, invoke }, 'system.operations', {})
      const operations = operationCatalog(policy).filter(
        op =>
          (!o.kind || op.kind === o.kind) &&
          (!o.contract || op.contract === o.contract) &&
          (!o.search ||
            `${op.id} ${op.summary}`.toLowerCase().includes(String(o.search).toLowerCase())) &&
          (!o.prefix || op.id.startsWith(String(o.prefix).replace(/\.$/, '') + '.')),
      )
      if (!o.domains) {
        return operations
      }
      const domains = new Map<
        string,
        { domain: string; operations: number; schema: number; commandOperations: number }
      >()
      for (const op of operations) {
        const domain = op.id.split('.')[0]
        const row = domains.get(domain) ?? {
          domain,
          operations: 0,
          schema: 0,
          commandOperations: 0,
        }
        row.operations++
        row.schema += Number(op.contract === 'schema')
        row.commandOperations += Number(op.kind === 'command')
        domains.set(domain, row)
      }
      return [...domains.values()]
    },
    selectRender: ({ options }) =>
      options.domains
        ? {
            list: true,
            fields: ['domain', 'operations', 'schema', 'commandOperations'],
            columns: ['domain', 'operations', 'schema', 'commandOperations'],
          }
        : commands.find(c => c.path.join(' ') === 'api ops')!.render!,
    render: {
      list: true,
      examples: [
        'opencove api ops --prefix node --fields id,cliCommand',
        '[{"id":"node.create","cliCommand":"opencove node create"}, ...]',
      ],
      fields: [
        'id',
        'kind',
        'contract',
        'summary',
        'cliCommand',
        'scope',
        'access',
        'allowed',
        'reason',
        'policyVersion',
        'rejectedFields',
      ],
      columns: ['id', 'kind', 'contract', 'cliCommand', 'scope', 'access'],
    },
  }),
  defineCommand({
    path: ['api', 'schema'],
    render: declaredOutput(
      [
        '$schema',
        'type',
        'properties',
        'required',
        'oneOf',
        'anyOf',
        'allOf',
        'additionalProperties',
        'items',
        '$defs',
        '$ref',
        'description',
        'enum',
        'const',
        'not',
        'access',
        'allowed',
        'reason',
        'policyVersion',
        'rejectedFields',
      ],
      { $schema: 'https://json-schema.org/draft/2020-12/schema' },
    ),
    summary: 'Show the input JSON Schema for an operation',
    description:
      'Inside OpenCove, access, reason, policyVersion and rejectedFields describe your Worker permissions; a field in the schema may still be refused. Outside OpenCove this command works offline.',
    connect: false,
    positionals: [{ name: 'operation-id', required: true }],
    options: {
      variant: {
        ...stringOption('Select one input kind from a discriminated union'),
        valueName: 'kind',
        choices: ({ positionals }) =>
          schemaVariants(positionals[0]).map(({ kind }) => String(kind)),
      },
    },
    async execute({ positionals, options, io, invoke }) {
      const op = getControlSurfaceOperation(positionals[0])
      if (!op) {
        unknownOperation(positionals[0])
      }
      if (op.contract !== 'schema') {
        throw new CliError('api.schema_unavailable', 1, `No input schema for ${op.id}`)
      }
      let input: z.ZodType = op.input
      if (options.variant !== undefined) {
        input = schemaVariants(op.id).find(({ kind }) => kind === options.variant)!.branch
      }
      const schema = z.toJSONSchema(input, { io: 'input', unrepresentable: 'throw', reused: 'ref' })
      const policy = await readWorkerPolicy({ io, invoke }, 'system.operation.describe', {
        id: op.id,
      })
      return {
        ...schema,
        ...(io.env.OPENCOVE_ENV === '1'
          ? (operationAccessInfo(policy) ?? { access: 'unknown' })
          : {}),
      }
    },
  }),
  defineCommand({
    path: ['api', 'call'],
    rawQueryFields: true,
    serverValidation: true,
    summary: 'Invoke a registered operation',
    description:
      'The input is sent as-is: IDs must be full IDs. Selectors such as @self, names and ID prefixes work only in the dedicated commands; resolve one first, for example: opencove node get --node "@self" --fields id',
    connect: true,
    positionals: [{ name: 'operation-id', required: true }],
    options: {
      input: {
        type: 'json',
        description: 'Pass the operation input as JSON',
        valueName: 'json',
        fileVariant: true,
      },
    },
    buildInput: ({ options: o }) => o.input ?? null,
  }),
]

async function readWorkerPolicy(
  ctx: Pick<CommandContext, 'io' | 'invoke'>,
  id: Parameters<CommandContext['invoke']>[0],
  payload: unknown,
): Promise<unknown> {
  if (ctx.io.env.OPENCOVE_ENV !== '1') {
    return
  }
  try {
    return await ctx.invoke(id, payload)
  } catch (error) {
    // Older Workers can lack discovery; authorization and transport errors stay visible.
    if (
      !(error instanceof CliError) ||
      error.exitCode === 4 ||
      error.code !== 'common.invalid_input'
    ) {
      throw error
    }
    return undefined
  }
}

for (const command of [...remoteCommands, ...pluginCommands, ...lifecycleCommands, ptyAttach]) {
  if (command.examples) {
    continue
  }
  const values: Record<string, string> = {
    id: 'sample',
    directory: './plugin',
    repository: 'https://github.com/example/plugin.git',
    'candidate-id': 'candidate-123',
    revision: 'revision-123',
    command: 'status',
    skill: 'usage',
  }
  const args = [
    ...command.path,
    ...(command.positionals ?? []).map(p => values[p.name] ?? 'sample'),
  ]
  for (const [name, spec] of Object.entries(command.options ?? {})) {
    if (!spec.required) {
      continue
    }
    args.push(
      `--${name}`,
      (
        {
          hostname: 'worker.example.com',
          port: '4312',
          'remote-token': 'remote-token',
          'root-path': '/workspace',
          prompt: '"Review the project"',
        } as Record<string, string>
      )[name] ?? `${name}-123`,
    )
  }
  command.examples = [`opencove ${args.join(' ')}`]
}

// The generic API command uses these same command declarations for known operations.
for (const command of commands) {
  command.errorTargets = errorTargets
}
function dedicatedCommand(id: string): string | undefined {
  const command = commands.find(
    c => c.operation === id || c.operationAliases?.some(alias => alias === id),
  )
  return command ? (command.operationCommand ?? `opencove ${command.path.join(' ')}`) : undefined
}

function operationCatalog(policy?: unknown) {
  const access = operationAccessCatalog(policy)
  return CONTROL_SURFACE_OPERATIONS.map(({ id, kind, contract, summary, scope }) => ({
    id,
    kind,
    contract,
    summary,
    cliCommand: dedicatedCommand(id),
    scope,
    ...(access.get(id) ?? { access: 'unknown' as const }),
  }))
}

function schemaVariants(id: string) {
  const op = getControlSurfaceOperation(id)
  if (!op && id) {
    unknownOperation(id)
  }
  const input = op?.contract === 'schema' ? op.input : undefined
  return input instanceof z.ZodDiscriminatedUnion
    ? input.options.flatMap(branch => {
        if (!(branch instanceof z.ZodObject) || !(branch.shape.kind instanceof z.ZodLiteral)) {
          return []
        }
        return [...branch.shape.kind.values].map(kind => ({ kind, branch }))
      })
    : []
}
