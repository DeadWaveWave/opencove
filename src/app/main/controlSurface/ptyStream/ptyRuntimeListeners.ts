export function subscribePtyRuntimeListener<Event>(
  listeners: Set<(event: Event) => void>,
  listener: (event: Event) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function subscribePtyRuntimeSources<Event>(
  sources: readonly { onState?: (listener: (event: Event) => void) => () => void }[],
  listeners: Set<(event: Event) => void>,
): Array<() => void> {
  return sources.flatMap(source => {
    const dispose = source.onState?.(event => listeners.forEach(listener => listener(event)))
    return dispose ? [dispose] : []
  })
}

export function subscribeAgentSources<StateEvent, MetadataEvent>(
  options: {
    agentStateSources?: readonly {
      onState?: (listener: (event: StateEvent) => void) => () => void
    }[]
    agentMetadataSources?: readonly {
      onMetadata?: (listener: (event: MetadataEvent) => void) => () => void
    }[]
  },
  stateListeners: Set<(event: StateEvent) => void>,
  metadataListeners: Set<(event: MetadataEvent) => void>,
): Array<() => void> {
  const stateSubscriptions = subscribePtyRuntimeSources(
    options.agentStateSources ?? [],
    stateListeners,
  )
  const metadataSubscriptions = (options.agentMetadataSources ?? []).flatMap(source => {
    const dispose = source.onMetadata?.(event =>
      metadataListeners.forEach(listener => listener(event)),
    )
    return dispose ? [dispose] : []
  })
  return [...stateSubscriptions, ...metadataSubscriptions]
}
