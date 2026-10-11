import type { PluginCommandDeclaration } from './pluginTypes'
import { pluginJsonValue } from './pluginJsonValue'

export interface PluginSidebarDeclaration {
  id: string
  title: string
  itemsCommand: string
}

export interface PluginSidebarItem {
  id: string
  label: string
  description?: string
  command?: { id: string; params?: unknown }
  children?: PluginSidebarItem[]
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !allowed.includes(key))
  ) {
    throw new Error('Invalid plugin Sidebar fields.')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error('Invalid plugin Sidebar text.')
  }
  return value.trim()
}

export function normalizePluginSidebar(
  value: unknown,
  commands: PluginCommandDeclaration[],
): PluginSidebarDeclaration[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error('Plugin Sidebar limit is 8 sections.')
  }
  const ids = new Set<string>()
  return value.map(item => {
    const raw = record(item, ['id', 'title', 'itemsCommand'])
    const id = text(raw.id, 80)
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) {
      throw new Error('Invalid or duplicate Sidebar id.')
    }
    ids.add(id)
    const itemsCommand = text(raw.itemsCommand, 80)
    if (!commands.some(command => command.id === itemsCommand && command.target === 'plugin')) {
      throw new Error('Sidebar itemsCommand must name a declared backend command.')
    }
    return { id, title: text(raw.title), itemsCommand }
  })
}

export function normalizePluginSidebarItems(
  value: unknown,
  commands: readonly PluginCommandDeclaration[],
): PluginSidebarItem[] {
  const raw = record(pluginJsonValue(value, 128 * 1024, 'Sidebar items'), ['items'])
  const ids = new Set<string>()
  const visit = (entries: unknown, depth: number): PluginSidebarItem[] => {
    if (!Array.isArray(entries) || depth > 5 || entries.length > 200) {
      throw new Error('Plugin Sidebar tree exceeds its item/depth limit.')
    }
    return entries.map(entry => {
      const item = record(entry, ['id', 'label', 'description', 'command', 'children'])
      const id = text(item.id, 100)
      if (ids.has(id)) {
        throw new Error('Duplicate Sidebar item id.')
      }
      ids.add(id)
      if (ids.size > 200) {
        throw new Error('Plugin Sidebar item limit is 200.')
      }
      const result: PluginSidebarItem = { id, label: text(item.label, 200) }
      if (item.description !== undefined) {
        result.description = text(item.description, 300)
      }
      if (item.command !== undefined) {
        const action = record(item.command, ['id', 'params'])
        const commandId = text(action.id, 80)
        if (
          !commands.some(
            command =>
              command.id === commandId &&
              command.target === 'plugin' &&
              command.menus?.includes('sidebar'),
          )
        ) {
          throw new Error('Item action must name a backend command declared for sidebar.')
        }
        result.command = {
          id: commandId,
          ...(action.params === undefined ? {} : { params: action.params }),
        }
      }
      if (item.children !== undefined) {
        result.children = visit(item.children, depth + 1)
      }
      return result
    })
  }
  return visit(raw.items, 1)
}
