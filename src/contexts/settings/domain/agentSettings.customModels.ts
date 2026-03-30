export type AgentCustomModelEnabledByProvider<TProvider extends string> = Record<TProvider, boolean>

export type AgentCustomModelByProvider<TProvider extends string> = Record<TProvider, string>

export type AgentCustomModelOptionsByProvider<TProvider extends string> = Record<
  TProvider,
  string[]
>
