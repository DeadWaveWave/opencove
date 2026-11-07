import { pluginOutputs } from './pluginOutputs'
import { resolve } from 'node:path'
import { defineCommand, type Command, type OperationId } from '../core/command'
import { CliError, usage } from '../core/errors'
import { createPluginGuideResult } from '../pluginGuide.mjs'
import { option } from './remote'
const operations = {
  list: 'plugin.list',
  details: 'plugin.details',
  install: 'plugin.install',
  reload: 'plugin.reload',
  uninstall: 'plugin.uninstall',
  enable: 'plugin.setEnabled',
  disable: 'plugin.setEnabled',
  'install-git': 'plugin.git.install',
  source: 'plugin.source',
  check: 'plugin.git.check',
  update: 'plugin.git.update',
  apply: 'plugin.git.apply',
  rollback: 'plugin.rollback',
  discover: 'plugin.discover',
  run: 'plugin.command.run',
  skill: 'plugin.skill.get',
  open: 'plugin.window.open',
  windows: 'plugin.window.list',
} as const satisfies Record<string, OperationId>
const summaries = {
  list: 'List installed plugins',
  details: 'Inspect plugin metadata',
  install: 'Install a plugin from a local directory',
  reload: 'Reload a plugin',
  uninstall: 'Uninstall a plugin',
  enable: 'Enable a plugin',
  disable: 'Disable a plugin',
  'install-git': 'Install a plugin from a Git repository',
  source: 'Inspect the plugin source',
  check: 'Check for a plugin update',
  update: 'Prepare a plugin update',
  apply: 'Apply a prepared plugin update',
  rollback: 'Restore a previous plugin revision',
  discover: 'Find available plugins',
  run: 'Run a plugin command',
  skill: 'Read a plugin skill',
  open: 'Open a plugin window',
  windows: 'List plugin windows',
}
export function resolvePluginCommandTimeout(
  request: { id: string },
  requestedTimeout?: number | null,
) {
  if (requestedTimeout !== null && requestedTimeout !== undefined) {
    return requestedTimeout
  }
  if (
    request.id.startsWith('plugin.git.') ||
    ['plugin.rollback', 'plugin.reload'].includes(request.id)
  ) {
    return 600_000
  }
  return ['plugin.install', 'plugin.command.run'].includes(request.id) ? 60_000 : null
}
export const pluginCommands: Command[] = [
  defineCommand({
    path: ['plugin', 'guide'],
    render: pluginOutputs.guide,
    summary: 'Read the plugin development and usage guide',
    connect: false,
    execute: async () => createPluginGuideResult(),
  }),
  ...Object.entries(operations).map(([name, operation]) =>
    defineCommand({
      path: ['plugin', name],
      render: pluginOutputs[name],
      summary: summaries[name as keyof typeof summaries],
      description:
        name === 'run'
          ? 'Inside OpenCove, window commands without an explicit node or project default to your own project. Plugin-wide commands receive no default target.'
          : undefined,
      connect: true,
      operation,
      timeoutMs: resolvePluginCommandTimeout({ id: operation }) ?? undefined,
      positionals: (['list', 'discover'].includes(name)
        ? []
        : [
            name === 'install'
              ? 'directory'
              : name === 'install-git'
                ? 'repository'
                : name === 'apply'
                  ? 'candidate-id'
                  : 'id',
            ...(['rollback', 'run', 'skill'].includes(name)
              ? [name === 'rollback' ? 'revision' : name === 'run' ? 'command' : 'skill']
              : []),
          ]
      ).map(argument => ({ name: argument, required: true })),
      options: {
        ...(['install-git', 'check', 'update'].includes(name)
          ? { ref: option('Use this Git ref', 'ref') }
          : {}),
        ...(name === 'install-git'
          ? {
              directory: option('Select the plugin directory within the repository', 'path'),
              build: {
                ...option('Choose an explicit build strategy', 'none|npm|pnpm'),
                choices: ['none', 'npm', 'pnpm'],
              },
              script: option('Run this package script', 'name'),
              'build-output': option('Read the built plugin from this directory', 'path'),
            }
          : {}),
        ...(name === 'discover' ? { query: option('Search for plugins', 'text') } : {}),
        ...(['run', 'open', 'windows'].includes(name)
          ? {
              project: {
                ...option('Select the project', 'id'),
                ...(name === 'run' ? { defaultSelf: false } : {}),
                ...(name === 'open' ? { defaultSelfUnless: ['node'] } : {}),
              },
            }
          : {}),
        ...(['run', 'open'].includes(name)
          ? { node: option('Select an existing plugin window', 'id') }
          : {}),
        ...(name === 'open'
          ? { space: { ...option('Place a new window in this space', 'id'), conflicts: ['node'] } }
          : {}),
        ...(name === 'run'
          ? {
              view: option('Select the plugin view', 'id'),
              params: {
                ...option('Pass command parameters as JSON', 'json', false, 'json'),
                fileVariant: true as const,
              },
            }
          : {}),
      },
      buildInput: ({ positionals: p, options: o }) => {
        if (name === 'list') {
          return null
        }
        if (name === 'install') {
          return { directory: resolve(p[0]) }
        }
        if (name === 'discover') {
          return { query: o.query ?? '' }
        }
        if (name === 'apply') {
          return { candidateId: p[0] }
        }
        if (name === 'install-git') {
          const kind = o.build ?? 'none'
          if (kind === 'none' && (o.script !== undefined || o['build-output'] !== undefined)) {
            usage(
              'Invalid plugin build options',
              'Choose --build npm or --build pnpm before specifying --script or --build-output.',
            )
          }
          return {
            repository: p[0],
            ...(o.ref !== undefined ? { ref: o.ref } : {}),
            directory: o.directory ?? '.',
            build:
              kind === 'none'
                ? { kind }
                : { kind, script: o.script ?? 'build', outputDirectory: o['build-output'] ?? '.' },
          }
        }
        if (
          ['run', 'skill', 'open', 'windows'].includes(name) &&
          (!/^[a-z][a-z0-9-]*$/.test(p[0]) ||
            (p[1] !== undefined && !/^[a-z][a-z0-9.-]*$/.test(p[1])))
        ) {
          usage(
            'Invalid plugin or contribution ID',
            `Run "opencove plugin ${name} --help" to see its arguments.`,
          )
        }
        if (name === 'open' && o.node !== undefined && o.space !== undefined) {
          usage(
            'Cannot use --node and --space together',
            'Use --node for an existing window, or --space for a new window.',
          )
        }
        if (name === 'run' && Buffer.byteLength(JSON.stringify(o.params ?? null)) > 1024 * 1024) {
          usage('Plugin --params exceeds 1 MiB', 'Pass a smaller JSON value.')
        }
        return {
          pluginId: p[0],
          ...Object.fromEntries(
            ['project', 'node', 'view', 'space']
              .filter(k => o[k] !== undefined)
              .map(k => [`${k}Id`, o[k]]),
          ),
          ...(o.ref !== undefined ? { ref: o.ref } : {}),
          ...(name === 'rollback' ? { revision: p[1] } : {}),
          ...(name === 'skill' ? { skillId: p[1] } : {}),
          ...(name === 'run' ? { commandId: p[1], params: o.params ?? null } : {}),
          ...(['enable', 'disable'].includes(name) ? { enabled: name === 'enable' } : {}),
        }
      },
      async execute({ invoke, input, options, io, self }) {
        if (
          name === 'run' &&
          io.env.OPENCOVE_ENV === '1' &&
          options.project === undefined &&
          options.node === undefined
        ) {
          const request = input as { pluginId: string; commandId: string }
          const details = (await invoke('plugin.details', { pluginId: request.pluginId })) as {
            plugin?: {
              revision?: string
              runtimeGeneration?: number
              commands?: { id: string; target: 'plugin' | 'window' }[]
            }
          }
          input = {
            ...request,
            expectedRevision: details.plugin?.revision,
            expectedRuntimeGeneration: details.plugin?.runtimeGeneration,
          }
          if (
            details.plugin?.commands?.find(command => command.id === request.commandId)?.target ===
            'window'
          ) {
            input = {
              ...(input as object),
              projectId: await self('project'),
            }
          }
        }
        const result = await invoke(operation, input)
        if (
          result &&
          typeof result === 'object' &&
          'status' in result &&
          ['failed', 'conflict'].includes(String(result.status))
        ) {
          throw new CliError(
            'plugin.failed',
            1,
            'Plugin operation needs attention',
            'Inspect the candidate details before retrying.',
            result,
          )
        }
        return result
      },
    }),
  ),
]
