import type { PluginViewContext } from '../domain/pluginRuntimeTypes'
import type { PluginManifest } from '../domain/pluginTypes'
import { pluginString } from '../domain/localPluginValidation'
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
  contentTitle?: string
}

export function recordPluginViewTitle(view: PluginRuntimeView, title: string): void {
  if (view.context.preview) {
    throw new Error('Preview titles are local to the preview.')
  }
  view.contentTitle = pluginString(title, 'window title', 200)
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

export function appendPluginRuntimeLog(runtime: PluginRuntimeState, message: string): void {
  runtime.logs.push(message.slice(0, 4000))
  if (runtime.logs.length > 100) {
    runtime.logs.shift()
  }
}
