import type { PluginViewContext } from '../domain/pluginRuntimeTypes'
import type { PluginManifest } from '../domain/pluginTypes'
import type { PluginBackend, PluginInstallationRecord, PluginSnapshot } from './PluginRuntimePorts'

export interface PluginRuntimeState {
  record: PluginInstallationRecord
  snapshot: PluginSnapshot | null
  backend: PluginBackend | null
  error: string | null
  logs: string[]
}

export interface PluginRuntimeView {
  id: string
  token: string
  runtime: PluginRuntimeState
  context: PluginViewContext
  backend: PluginBackend | null
  storage: Map<string, unknown>
}

const generations = new WeakMap<PluginRuntimeState, number>()
let nextGeneration = 0

/** Volatile identity changes for activation, even when the installed artifact is unchanged. */
export function pluginRuntimeGeneration(runtime: PluginRuntimeState): number {
  let generation = generations.get(runtime)
  if (generation === undefined) {
    generation = ++nextGeneration
    generations.set(runtime, generation)
  }
  return generation
}

export function assertPluginRuntimeGeneration(
  runtime: PluginRuntimeState,
  expected: Pick<PluginManifest, 'revision' | 'runtimeGeneration'> | undefined,
): void {
  if (
    expected &&
    (runtime.record.revision !== expected.revision ||
      pluginRuntimeGeneration(runtime) !== expected.runtimeGeneration)
  ) {
    throw new Error('Plugin changed before command dispatch; the command was not run.')
  }
}
