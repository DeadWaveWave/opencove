import type { NormalizedPersistedNodeContract } from '../contracts/normalizedPersistedAppState'
import { mergeValue } from './mergeValue'

interface NodeNaming {
  title: string
  titlePinnedByUser?: boolean
  titleIsLiteral?: boolean
}

function namingTuple(node: NodeNaming) {
  return [node.title, node.titlePinnedByUser === true, node.titleIsLiteral === true] as const
}

/** Explicit names outrank derived titles; peers merge their entire naming intent atomically. */
export function mergeNodeNaming(
  latest: NodeNaming,
  local: NodeNaming,
  ancestor: NodeNaming | null = null,
): NodeNaming {
  let source = local
  if ((latest.titlePinnedByUser === true) !== (local.titlePinnedByUser === true)) {
    source = latest.titlePinnedByUser === true ? latest : local
  } else if (ancestor) {
    const latestName = namingTuple(latest)
    source =
      mergeValue(latestName, namingTuple(local), namingTuple(ancestor)) === latestName
        ? latest
        : local
  }
  return {
    title: source.title,
    titlePinnedByUser: source.titlePinnedByUser,
    titleIsLiteral: source.titleIsLiteral,
  }
}

export function mergePersistedNode(
  latest: NormalizedPersistedNodeContract,
  local: NormalizedPersistedNodeContract,
  ancestor: NormalizedPersistedNodeContract | null = null,
): NormalizedPersistedNodeContract {
  return {
    ...(ancestor ? mergeValue(latest, local, ancestor) : local),
    ...mergeNodeNaming(latest, local, ancestor),
  }
}
