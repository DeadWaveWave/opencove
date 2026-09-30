import { describe, expect, it } from 'vitest'
import {
  parsePluginCommand,
  resolvePluginCommandTimeout,
} from '../../../src/app/cli/commands/plugins.mjs'

describe('plugin contribution CLI parsing before connection', () => {
  it('routes explicit window/client identity and JSON without shell interpretation', () => {
    expect(
      parsePluginCommand([
        'plugin',
        'run',
        'sample',
        'set-label',
        '--node',
        'node-id',
        '--view',
        'view-id',
        '--params',
        '{"text":"$HOME `literal`"}',
      ]),
    ).toEqual({
      kind: 'command',
      id: 'plugin.command.run',
      payload: {
        pluginId: 'sample',
        commandId: 'set-label',
        nodeId: 'node-id',
        viewId: 'view-id',
        params: { text: '$HOME `literal`' },
      },
    })
    expect(resolvePluginCommandTimeout({ id: 'plugin.command.run' }, null)).toBe(60000)
    expect(resolvePluginCommandTimeout({ id: 'plugin.command.run' }, 1200)).toBe(1200)
  })
  it.each([
    {
      args: ['open', 'sample', '--project', 'project-a'],
      id: 'plugin.window.open',
      kind: 'command',
      payload: { pluginId: 'sample', projectId: 'project-a' },
    },
    {
      args: ['windows', 'sample'],
      id: 'plugin.window.list',
      kind: 'query',
      payload: { pluginId: 'sample' },
    },
    {
      args: ['skill', 'sample', 'usage'],
      id: 'plugin.skill.get',
      kind: 'query',
      payload: { pluginId: 'sample', skillId: 'usage' },
    },
    {
      args: ['run', 'sample', 'status'],
      id: 'plugin.command.run',
      kind: 'command',
      payload: { pluginId: 'sample', commandId: 'status', params: null },
    },
    {
      args: ['run', 'sample', 'adjust', '--params', '-1'],
      id: 'plugin.command.run',
      kind: 'command',
      payload: { pluginId: 'sample', commandId: 'adjust', params: -1 },
    },
  ])('parses $args', ({ args, ...request }) => {
    expect(parsePluginCommand(['plugin', ...args])).toEqual(request)
  })
  it.each([
    ['run', 'sample'],
    ['run', 'sample', 'status', '--unknown', 'value'],
    ['run', 'sample', 'status', '--node'],
    ['run', 'sample', 'status', '--params', '{bad}'],
    ['run', 'sample', 'status', '--params', '{}', '--params', '{}'],
    ['skill', 'sample', 'usage', 'extra'],
    ['open', 'sample', '--node', 'x', '--node', 'y'],
    ['open', 'sample', '--node', 'x', '--space', 'space'],
    ['windows'],
  ])('rejects incomplete or ambiguous arguments %j', (...args) => {
    expect(() => parsePluginCommand(['plugin', ...args])).toThrow()
  })
})
