import { remoteOutputs } from './outputContracts'
import { defineCommand, type Command, type OptionSpec, type OperationId } from '../core/command'
import { usage } from '../core/errors'
import { AGENT_PROVIDER_IDS } from '../../../shared/contracts/dto'

export function option(
  description: string,
  valueName = 'id',
  required = false,
  type: OptionSpec['type'] = 'string',
): OptionSpec {
  return { type, description, valueName, required }
}
export function mapped(
  path: string,
  operation: OperationId,
  summary: string,
  fields: Record<string, [string, OptionSpec]>,
  nullEmpty = false,
): Command {
  return defineCommand({
    path: path.split(' '),
    operation,
    summary,
    render: remoteOutputs[operation],
    connect: true,
    options: Object.fromEntries(
      Object.entries(fields).map(([flag, [inputPath, spec]]) => [flag, { ...spec, inputPath }]),
    ),
    buildInput: ({ options }) => {
      const payload = Object.fromEntries(
        Object.entries(fields)
          .filter(([flag]) => options[flag] !== undefined)
          .map(([flag, [key]]) => [key, options[flag]]),
      )
      return nullEmpty && !Object.keys(payload).length ? null : payload
    },
  })
}
const id = (name: string, required = true): OptionSpec =>
  option(`Select the ${name}`, 'id', required)
export const remoteCommands: Command[] = [
  mapped('endpoint list', 'endpoint.list', 'List registered endpoints', {}, true),
  mapped('endpoint register', 'endpoint.register', 'Register a remote worker', {
    hostname: ['hostname', option('Connect to this worker host', 'host', true)],
    port: ['port', option('Connect to this worker port', 'port', true, 'number')],
    'remote-token': ['token', option('Authenticate with the remote worker token', 'token', true)],
    'display-name': ['displayName', option('Name the worker connection', 'name')],
  }),
  mapped('endpoint ping', 'endpoint.ping', 'Check a remote worker connection', {
    'endpoint-id': ['endpointId', id('endpoint')],
    'ping-timeout': ['timeoutMs', option('Limit the remote ping duration', 'ms', false, 'number')],
  }),
  mapped('endpoint remove', 'endpoint.remove', 'Remove a registered endpoint', {
    'endpoint-id': ['endpointId', id('endpoint')],
  }),
  mapped('mount list', 'mount.list', 'List project mounts', {
    project: ['projectId', id('project')],
  }),
  mapped('mount create', 'mount.create', 'Mount a worker folder in a project', {
    project: ['projectId', id('project')],
    'endpoint-id': ['endpointId', id('endpoint')],
    'root-path': ['rootPath', option('Mount this absolute folder path', 'path', true)],
    name: ['name', option('Name the mount', 'name')],
  }),
  mapped('mount resolve', 'mountTarget.resolve', 'Resolve a mount location', {
    mount: ['mountId', id('mount')],
  }),
  mapped('mount remove', 'mount.remove', 'Remove a project mount', {
    mount: ['mountId', id('mount')],
  }),
  mapped(
    'worktree list',
    'worktree.list',
    'List Git worktrees',
    { project: ['projectId', id('project', false)] },
    true,
  ),
  mapped('worktree create', 'worktree.create', 'Create a worktree for a space', {
    space: ['spaceId', id('space')],
    name: ['name', option('Name the worktree branch', 'branch')],
  }),
  mapped('worktree archive', 'worktree.archive', 'Archive a space worktree', {
    space: ['spaceId', id('space')],
    force: ['force', option('Archive despite uncommitted changes', '', false, 'boolean')],
    'delete-branch': ['deleteBranch', option('Delete the worktree branch', '', false, 'boolean')],
  }),
  mapped('session run-agent', 'session.launchAgent', 'Launch an agent in a space', {
    space: ['spaceId', id('space')],
    prompt: ['prompt', { ...option('Give the agent its task', 'text', true), fileVariant: true }],
    provider: [
      'provider',
      {
        ...option('Select the agent provider', 'provider'),
        choices: [...AGENT_PROVIDER_IDS, ''],
        normalize: value => value.trim(),
      },
    ],
    model: ['model', option('Select the agent model', 'model')],
  }),
  ...(
    [
      ['get', 'session.get', 'Inspect an agent session'],
      ['final', 'session.finalMessage', 'Read the final agent message'],
      ['kill', 'session.kill', 'Stop an agent session'],
    ] as const
  ).map(([name, operation, summary]) =>
    mapped(`session ${name}`, operation, summary, { session: ['sessionId', id('session')] }),
  ),
  mapped('pty spawn-in-mount', 'pty.spawnInMount', 'Start a terminal in a mount', {
    mount: ['mountId', id('mount')],
    'cwd-uri': ['cwdUri', option('Start in this directory URI', 'uri')],
    shell: ['shell', option('Run this shell', 'path')],
    'profile-id': ['profileId', id('terminal profile', false)],
    cols: ['cols', option('Set terminal columns', 'count', false, 'number')],
    rows: ['rows', option('Set terminal rows', 'count', false, 'number')],
  }),
]
const register = remoteCommands.find(c => c.path.join(' ') === 'endpoint register')!
const registerInput = register.buildInput!
register.buildInput = args => {
  const port = Number(args.options.port)
  if (port <= 0 || port > 65535) {
    usage(
      'Invalid --port: expected a number from 1 to 65535',
      'Run "opencove endpoint register --help" to see its options.',
    )
  }
  return registerInput(args)
}

for (const command of remoteCommands.filter(c =>
  ['endpoint ping', 'pty spawn-in-mount'].includes(c.path.join(' ')),
)) {
  const build = command.buildInput!
  command.buildInput = args => {
    const payload = build(args) as Record<string, unknown>
    for (const key of ['timeoutMs', 'cols', 'rows']) {
      if (payload[key] === undefined) {
        continue
      }
      const value = Number(payload[key])
      if (value > 0) {
        payload[key] = Math.floor(value)
      } else {
        delete payload[key]
      }
    }
    return payload
  }
}
