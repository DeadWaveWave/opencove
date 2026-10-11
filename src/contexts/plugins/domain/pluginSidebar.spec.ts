import { describe, expect, it } from 'vitest'
import { normalizeLocalPluginPackage } from './localPluginValidation'
import { normalizePluginSidebarItems } from './pluginSidebar'

const commands = [
  { id: 'items', title: 'Items', description: 'Read items', target: 'plugin' as const, menus: [] },
  {
    id: 'run',
    title: 'Run',
    description: 'Run item',
    target: 'plugin' as const,
    menus: ['sidebar' as const],
  },
]
const pkg = {
  apiVersion: 1,
  id: 'sidebar-test',
  version: '1.0.0',
  displayName: 'Sidebar',
  description: 'Test',
  main: 'main.mjs',
  contributes: { commands, sidebar: [{ id: 'checks', title: 'Checks', itemsCommand: 'items' }] },
}

describe('plugin Sidebar contract', () => {
  it('requires a declared backend provider and preserves the declaration', () => {
    expect(normalizeLocalPluginPackage(pkg).contributes?.sidebar).toEqual(pkg.contributes.sidebar)
    expect(() =>
      normalizeLocalPluginPackage({
        ...pkg,
        contributes: {
          ...pkg.contributes,
          sidebar: [{ id: 'checks', title: 'Checks', itemsCommand: 'missing' }],
        },
      }),
    ).toThrow(/command/i)
  })
  it('accepts bounded nested text items and declared backend actions', () => {
    const items = [
      {
        id: 'group',
        label: 'Group',
        children: [
          {
            id: 'child',
            label: 'Child',
            description: 'Ready',
            command: { id: 'run', params: { check: 1 } },
          },
        ],
      },
    ]
    expect(normalizePluginSidebarItems({ items }, commands)).toEqual(items)
  })
  it('rejects duplicate IDs, undeclared actions, missing sidebar placement and oversized trees', () => {
    expect(() =>
      normalizePluginSidebarItems(
        {
          items: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'B' },
          ],
        },
        commands,
      ),
    ).toThrow(/duplicate/i)
    expect(() =>
      normalizePluginSidebarItems(
        { items: [{ id: 'a', label: 'A', command: { id: 'items' } }] },
        commands,
      ),
    ).toThrow(/sidebar/i)
    expect(() =>
      normalizePluginSidebarItems(
        { items: Array.from({ length: 201 }, (_, n) => ({ id: String(n), label: 'A' })) },
        commands,
      ),
    ).toThrow(/limit/i)
    expect(() =>
      normalizePluginSidebarItems(
        { items: [{ id: 'a', label: 'A', command: { id: 'missing' } }] },
        commands,
      ),
    ).toThrow(/sidebar/i)
  })
  it('keeps arbitrary HTML as plain text and does not admit URLs or script-shaped actions', () => {
    expect(
      normalizePluginSidebarItems(
        { items: [{ id: 'x', label: '<script>bad()</script>' }] },
        commands,
      )[0].label,
    ).toBe('<script>bad()</script>')
    expect(() =>
      normalizePluginSidebarItems(
        { items: [{ id: 'a', label: 'A', command: { id: 'run', href: 'javascript:bad()' } }] },
        commands,
      ),
    ).toThrow()
  })
})
