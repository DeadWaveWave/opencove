const ELECTRON_RUN_AS_NODE_KEY = 'ELECTRON_RUN_AS_NODE'

export function removeElectronRunAsNode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv = { ...env }
  delete nextEnv[ELECTRON_RUN_AS_NODE_KEY]
  return nextEnv
}
