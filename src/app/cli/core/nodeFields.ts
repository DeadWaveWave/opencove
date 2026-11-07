import type { RenderSpec } from './command'
import { get } from './render'

/** Missing kind-specific content must not look like a successfully read empty note. */
export function nodeFieldNotice(
  value: unknown,
  options: Record<string, unknown>,
  spec?: RenderSpec,
): string | undefined {
  const nodeKey = spec?.rawItemKey ?? spec?.listKey ?? spec?.itemKey
  if (options.fields === undefined || !['node', 'nodes'].includes(nodeKey ?? '')) {
    return undefined
  }
  const fields = String(options.fields)
    .split(',')
    .map(field => field.trim())
  const missing = new Set<string>()
  const envelope = value as { node?: unknown; nodes?: unknown[] } | null
  const nodes = envelope?.nodes ?? (envelope?.node ? [envelope.node] : [])
  for (const node of nodes) {
    const kind = get(node, 'kind')
    if (typeof kind !== 'string') {
      continue
    }
    for (const field of fields) {
      const relative = field.replace(/^nodes?\./, '')
      if (spec?.rawPaths && !/^nodes?\./.test(field) && !spec.aliases?.[field]) {
        continue
      }
      if (get(node, relative) === undefined) {
        missing.add(`${relative} (${kind})`)
      }
    }
  }
  return missing.size
    ? `Notice: requested fields are absent on returned node kinds: ${[...missing].join(', ')}. Note content is data.text; use node get for full content.`
    : undefined
}
