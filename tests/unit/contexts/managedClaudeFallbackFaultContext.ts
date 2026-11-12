import { createMountOnlySpaceBoundary } from '../../../src/shared/types/spaceBoundary'
import type { ShellCase } from './managedClaudeFallbackFaultCases'
import type { ManagedClaudeFaultModel } from './managedClaudeFaultModel'

export function shellExecution(config: ShellCase) {
  const explicit = config.route === 'mount'
  const lostMount = explicit && config.initialContext === 'inheritedRemote'
  return {
    cwd: config.initialContext === 'boundary' && !explicit ? '/repo/other' : '/repo',
    endpointId: config.initialContext === 'inheritedRemote' && !explicit ? 'remote' : 'local',
    mountId: lostMount ? null : explicit || config.initialContext ? 'mount' : null,
  }
}
export function shellContextPermitted(config: ShellCase): boolean {
  return config.initialContext === 'boundary'
    ? config.route === 'mount'
    : !['inheritedRemote', 'retargetRemote'].includes(config.initialContext ?? '')
}
export function shellAppState(
  model: ManagedClaudeFaultModel,
  peer: ManagedClaudeFaultModel,
  config: ShellCase,
) {
  const state = model.appState()
  state.workspaces[0].nodes.push(...peer.appState().workspaces[0].nodes)
  for (const value of state.workspaces[0].nodes) {
    if (value.id === 'agent') {
      value.status = config.mode === 'stopped' ? 'stopped' : 'standby'
      Object.assign(value, { workerBinding: model.workerBinding })
    }
  }
  if (config.initialContext) {
    const scope = config.initialContext === 'boundary' ? '/repo/other' : '/repo'
    Object.assign(state.workspaces[0], {
      spaces: [
        {
          id: 'space',
          name: 'Space',
          directoryPath: '/repo',
          targetMountId: 'mount',
          nodeIds: ['agent'],
          boundary: createMountOnlySpaceBoundary({
            mountId: 'mount',
            rootPath: scope,
            rootUri: `file://${scope}`,
          }),
        },
      ],
    })
  }
  return state
}
