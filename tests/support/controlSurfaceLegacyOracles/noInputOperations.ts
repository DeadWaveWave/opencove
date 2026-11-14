// @compat-file control-surface-legacy-validation
// Frozen validators: topologyHandlers.ts:102, systemHandlers.ts:37,
// managedRuntimeHandlers.ts:28 at 6df96903c64d6fb3c541c79815713996d3c1b186.
export const noInputOracles: Record<string, (payload: unknown) => unknown> = {
  'endpoint.overview.list': payload => payload ?? null,
  'system.homeDirectory': payload => payload ?? null,
  'worker.maintenance.status': () => null,
}
