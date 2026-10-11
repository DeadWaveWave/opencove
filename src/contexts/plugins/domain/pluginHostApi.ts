/** One method inventory for both the browser bridge and trusted Node backend. */
export const PLUGIN_HOST_METHODS = {
  target: ['list', 'resolve'],
  filesystem: [
    'readDirectory',
    'readText',
    'stat',
    'writeText',
    'mkdir',
    'rename',
    'delete',
    'watch',
    'readWatch',
    'unwatch',
  ],
  operations: ['start', 'get', 'cancel'],
  preferences: ['get', 'set'],
  nodes: ['list', 'get', 'create', 'update', 'focus', 'close'],
  terminals: ['create', 'get', 'read', 'write', 'interrupt', 'stop'],
  agents: ['launch', 'get', 'read', 'write', 'interrupt', 'stop'],
  events: ['subscribe', 'poll', 'dispose'],
} as const

export type PluginHostApi = {
  readonly [Group in keyof typeof PLUGIN_HOST_METHODS]: {
    readonly [Method in (typeof PLUGIN_HOST_METHODS)[Group][number]]: (
      input?: unknown,
    ) => Promise<unknown>
  }
}

export function createPluginHostApi(
  request: (operation: string, payload: unknown) => Promise<unknown>,
): PluginHostApi {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(PLUGIN_HOST_METHODS).map(([group, methods]) => [
        group,
        Object.freeze(
          Object.fromEntries(
            methods.map(method => [
              method,
              (input: unknown = {}) => request(`${group}.${method}`, input),
            ]),
          ),
        ),
      ]),
    ),
  ) as PluginHostApi
}
