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
import { defineCommand } from '../core/command'
import { CliError, usage } from '../core/errors'
import { nodeCommands, stringOption } from './nodes'
export const commands = [
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
      buildInput: () => null,
    }),
  ),
  defineCommand({
    path: ['project', 'list'],
    summary: 'List projects',
    connect: true,
    operation: 'project.list',
    buildInput: () => null,
    render: { listKey: 'projects', columns: ['id', 'name'] },
  }),
  defineCommand({
    path: ['space', 'list'],
    summary: 'List spaces',
    connect: true,
    operation: 'space.list',
    options: { project: stringOption('Project ID') },
    buildInput: ({ options: o }) => (o.project ? { projectId: o.project } : null),
    render: { listKey: 'spaces', columns: ['id', 'name', 'projectId'] },
  }),
  defineCommand({
    path: ['space', 'get'],
    summary: 'Get a space',
    connect: true,
    operation: 'space.get',
    options: { space: stringOption('Space ID', true) },
    buildInput: ({ options: o }) => ({ spaceId: o.space }),
  }),
  defineCommand({
    path: ['api', 'ops'],
    summary: 'List local operations',
    connect: false,
    options: {
      kind: { type: 'string', valueName: 'query|command', description: 'Filter by operation kind' },
      contract: {
        type: 'string',
        valueName: 'schema|legacy',
        description: 'Filter by input contract availability',
      },
    },
    async execute({ options: o }) {
      if (o.kind && !['query', 'command'].includes(String(o.kind))) {
        usage('Invalid kind')
      }
      if (o.contract && !['schema', 'legacy'].includes(String(o.contract))) {
        usage('Invalid contract')
      }
      return CONTROL_SURFACE_OPERATIONS.filter(
        op => (!o.kind || op.kind === o.kind) && (!o.contract || op.contract === o.contract),
      ).map(({ id, kind, contract, summary }) => ({ id, kind, contract, summary }))
    },
    render: { columns: ['id', 'kind', 'contract'] },
  }),
  defineCommand({
    path: ['api', 'schema'],
    summary: 'Show the input JSON Schema for an operation',
    connect: false,
    positionals: [{ name: 'operation-id', required: true }],
    async execute({ positionals }) {
      const op = getControlSurfaceOperation(positionals[0])
      if (!op) {
        usage('Unknown operation')
      }
      if (op.contract !== 'schema') {
        throw new CliError('api.schema_unavailable', 1, `No input schema for ${op.id}`)
      }
      return z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })
    },
  }),
  defineCommand({
    path: ['api', 'call'],
    summary: 'Invoke a registered operation',
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
