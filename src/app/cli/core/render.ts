import type { RenderSpec } from './command'
import { limitOutput } from './listOutput'
import { usage } from './errors'
import { hasPath, outputPaths, project } from './projection'

function ownValue<T>(dictionary: Record<string, T> | undefined, key: string): T | undefined {
  return dictionary && Object.hasOwn(dictionary, key) ? dictionary[key] : undefined
}

/** Reuse dedicated item contracts while preserving generic query output paths. */
export function rawRenderSpec(spec?: RenderSpec): RenderSpec {
  const itemKey = spec?.listKey ?? spec?.itemKey
  const aliases = Object.fromEntries(
    (spec?.fields ?? []).map(field => [
      field,
      ownValue(spec?.envelopeFields, field) ?? (itemKey ? `${itemKey}.${field}` : field),
    ]),
  )
  return {
    rawPaths: true,
    aliases,
    declaredRawPaths: [...Object.values(aliases), ...(spec?.itemAtRoot ? (spec.fields ?? []) : [])],
    rawItemKey: itemKey,
    fieldHints: spec?.fieldHints,
  }
}
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
  const keys = requested.map(key => {
    const itemKey = spec.listKey ?? spec.itemKey
    return itemKey && key.startsWith(itemKey + '.') ? key.slice(itemKey.length + 1) : key
  })
  const unknown = keys.filter(key => !spec.fields!.includes(key))
  if (unknown.length) {
    usage(
      `Unknown fields: ${unknown.join(', ')}. Available fields: ${spec.fields.join(', ')}`,
      unknown.map(key => ownValue(spec.fieldHints, key)).find(Boolean),
    )
  }
  return keys.map(key => ownValue(spec.aliases, key) ?? key)
}
export function validateRenderOptions(options: Record<string, unknown>, spec: RenderSpec = {}) {
  selectedFields(options, spec)
  if (options.output === 'table' && !spec.columns?.length) {
    usage('Table output is unavailable for this command')
  }
}
export function render(value: unknown, options: Record<string, unknown>, spec: RenderSpec = {}) {
  validateRenderOptions(options, spec)
  let keys = selectedFields(options, spec)
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
    const declared = spec.declaredRawPaths ?? []
    const valid = (key: string) => declared.includes(key) || hasPath(value, key.split('.'))
    // A real raw path wins over a colliding item alias, preserving existing callers.
    const resolved = keys.map(key => (valid(key) ? key : (ownValue(spec.aliases, key) ?? key)))
    const unknown = keys.filter((key, i) => !key || !valid(resolved[i]))
    if (unknown.length) {
      const available = [...new Set([...declared, ...outputPaths(value)])]
      const relative = unknown.filter(
        key => spec.rawItemKey && !key.startsWith(spec.rawItemKey + '.'),
      )
      const example = Object.values(spec.aliases ?? {})[0]
      const hint = unknown
        .map(key =>
          ownValue(
            spec.fieldHints,
            spec.rawItemKey && key.startsWith(spec.rawItemKey + '.')
              ? key.slice(spec.rawItemKey.length + 1)
              : key,
          ),
        )
        .find(Boolean)
      usage(
        `Unknown output paths: ${unknown.join(', ')}. Available raw paths: ${available.join(', ') || 'none'}`,
        hint ??
          (relative.length
            ? `Item-relative paths use the ${spec.rawItemKey} prefix (for example, ${example}); check ${relative.map(key => JSON.stringify(`${spec.rawItemKey}.${key}`)).join(', ')} against the available raw paths.`
            : undefined),
      )
    }
    keys = resolved
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
      columns.map(column => column.toUpperCase()),
      ...rows.slice(0, Number(options.limit) > 0 ? Number(options.limit) : undefined).map(row =>
        columns.map(key => {
          const paths = ownValue(spec.tableFields, key) ?? [key]
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
  return (
    JSON.stringify(
      limitOutput(value ?? null, options.limit, spec.defaultLimit ? spec.listKey : undefined),
      null,
      options.pretty ? 2 : undefined,
    ) + '\n'
  )
}
