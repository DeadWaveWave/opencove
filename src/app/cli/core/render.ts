import type { RenderSpec } from './command'
import { usage } from './errors'
function get(value: unknown, key: string): unknown {
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
function fields(value: unknown, prefix = ''): string[] {
  return value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, v]) => [prefix + key, ...fields(v, `${prefix}${key}.`)])
    : []
}
export function validateRenderOptions(options: Record<string, unknown>, spec: RenderSpec = {}) {
  if (options.output === 'table' && !spec.columns?.length) {
    usage('Table output is unavailable for this command')
  }
}
export function render(value: unknown, options: Record<string, unknown>, spec: RenderSpec = {}) {
  validateRenderOptions(options, spec)
  const list = spec.listKey ? get(value, spec.listKey) : value
  const rows = Array.isArray(list) ? list : [list]
  if (options.fields) {
    const keys = String(options.fields).split(',')
    let matches = 0
    const projected = rows.map(row => {
      const out: Record<string, unknown> = Object.create(null)
      for (const key of keys) {
        const v = get(row, key)
        if (v === undefined) {
          continue
        }
        matches++
        let target = out
        const parts = key.split('.')
        for (const part of parts.slice(0, -1)) {
          target = (target[part] ??= Object.create(null)) as Record<string, unknown>
        }
        target[parts.at(-1)!] = v
      }
      return out
    })
    if (!matches) {
      usage(
        `No matching fields. Available fields: ${[...new Set(rows.flatMap(row => fields(row)))].join(', ')}`,
      )
    }
    value =
      spec.listKey && value && typeof value === 'object'
        ? { ...value, [spec.listKey]: projected }
        : Array.isArray(list)
          ? projected
          : projected[0]
  }
  if (options.output === 'table') {
    const columns = spec.columns!
    const cells = [
      columns,
      ...rows.map(row =>
        columns.map(key => {
          const v = get(row, key)
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
