import type { RenderSpec } from './command'
import { usage } from './errors'
import { hasPath, project } from './projection'
export function get(value: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === 'object' && Object.hasOwn(v, k)
          ? (v as Record<string, unknown>)[k]
          : undefined,
      value,
    )
}
function selectedFields(options: Record<string, unknown>, spec: RenderSpec): string[] | undefined {
  if (options.fields === undefined) {
    return spec.defaultFields
  }
  const requested = String(options.fields)
    .split(',')
    .map(key => key.trim())
  if (requested.some(key => key.split('.').some(part => /^-?\d+$/.test(part)))) {
    usage(
      'Numeric field segments are not supported. Use item fields such as nodes.id to select id from every array element; arrays remain arrays.',
    )
  }
  if (spec.rawPaths) {
    return requested
  }
  if (!spec.fields) {
    usage('--fields is unavailable for this command. Available fields: none', spec.unavailable)
  }
  const keys = String(options.fields)
    .split(',')
    .map(key => {
      const trimmed = key.trim()
      const itemKey = spec.listKey ?? spec.itemKey
      return itemKey && trimmed.startsWith(itemKey + '.')
        ? trimmed.slice(itemKey.length + 1)
        : trimmed
    })
  const unknown = keys.filter(key => !spec.fields!.includes(key))
  if (unknown.length) {
    usage(`Unknown fields: ${unknown.join(', ')}. Available fields: ${spec.fields.join(', ')}`)
  }
  return keys
}
export function validateRenderOptions(options: Record<string, unknown>, spec: RenderSpec = {}) {
  selectedFields(options, spec)
  if (options.output === 'table' && !spec.columns?.length) {
    usage('Table output is unavailable for this command')
  }
}
export function render(value: unknown, options: Record<string, unknown>, spec: RenderSpec = {}) {
  validateRenderOptions(options, spec)
  const keys = selectedFields(options, spec)
  const itemKey =
    spec.itemAtRoot && spec.itemKey && get(value, spec.itemKey) === undefined
      ? undefined
      : (spec.listKey ?? spec.itemKey)
  const list = itemKey ? get(value, itemKey) : value
  const isList = !!spec.listKey || spec.list
  const rows = (isList ? (Array.isArray(list) ? list : []) : [list]).map(row => {
    if (!spec.envelopeFields) {
      return row
    }
    return {
      ...Object.fromEntries(
        Object.entries(spec.envelopeFields).map(([field, path]) => [field, get(value, path)]),
      ),
      ...(row as object),
    }
  })
  if (keys && spec.rawPaths) {
    const unknown = keys.filter(key => !key || !hasPath(value, key.split('.')))
    if (unknown.length) {
      usage(`Unknown output paths: ${unknown.join(', ')}`)
    }
  }
  if (keys) {
    const projected = rows.map(row =>
      project(
        row,
        keys.map(key => key.split('.')),
      ),
    )
    const narrowed = isList ? projected : projected[0]
    value = itemKey ? { ...(value as object), [itemKey]: narrowed } : narrowed
  }
  if (options.output === 'table') {
    const columns = options.fields !== undefined ? keys! : spec.columns!
    const cells = [
      columns,
      ...rows.map(row =>
        columns.map(key => {
          const paths = spec.tableFields?.[key] ?? [key]
          const v = paths
            .map(path => get(row, path))
            .find(item => item !== undefined && item !== null)
          return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
        }),
      ),
    ]
    const widths = columns.map((_, i) => Math.max(...cells.map(row => row[i].length)))
    return (
      cells
        .map(row =>
          row
            .map((cell, i) => cell.padEnd(widths[i]))
            .join('  ')
            .trimEnd(),
        )
        .join('\n') + '\n'
    )
  }
  return JSON.stringify(value ?? null, null, options.pretty ? 2 : undefined) + '\n'
}
