import { normalizeHomeWorkerConfigurationSnapshot } from '../runtime/homeWorkerConfigurationValidation'
import { createAppError } from './appError'

/** Ignore inherited properties and accessors, including hostile DTO getters. */
export function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

export function projectConfigurationSnapshot(value: unknown) {
  try {
    // Build a bounded, data-only DTO before using the existing validation policy.
    const rawConfig = ownValue(value, 'config')
    const webUi = ownValue(rawConfig, 'webUi')
    const runtime = ownValue(value, 'webAccess')
    const state = ownValue(runtime, 'state')
    const host = (key: string) => {
      const hostValue = ownValue(runtime, key)
      return typeof hostValue === 'string' && /^[a-zA-Z0-9.:[\]-]{1,253}$/.test(hostValue)
        ? hostValue
        : undefined
    }
    const generations = ownValue(runtime, 'drainingGenerations')
    if (!Array.isArray(generations) || generations.length > 100) {
      return undefined
    }
    const config = {
      version: ownValue(rawConfig, 'version'),
      mode: ownValue(rawConfig, 'mode'),
      remote: ownValue(rawConfig, 'remote'),
      updatedAt: ownValue(rawConfig, 'updatedAt'),
      webUi: Object.fromEntries(
        ['enabled', 'port', 'exposeOnLan', 'passwordSet'].map(key => [key, ownValue(webUi, key)]),
      ),
    }
    if (config.mode === 'remote' || config.remote !== null) {
      return undefined
    }
    return normalizeHomeWorkerConfigurationSnapshot({
      config,
      webAccess: {
        state,
        generation: ownValue(runtime, 'generation'),
        drainingGenerations: Array.from({ length: generations.length }, (_, i) =>
          ownValue(generations, String(i)),
        ),
        hostname: host('hostname'),
        bindHostname: host('bindHostname'),
        port: ownValue(runtime, 'port'),
        passwordRequired: ownValue(runtime, 'passwordRequired'),
        ...(state === 'failed' || state === 'degraded'
          ? { error: createAppError('worker.unavailable').message }
          : {}),
      },
    })
  } catch {
    return undefined
  }
}
