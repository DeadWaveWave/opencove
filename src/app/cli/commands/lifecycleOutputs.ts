import { declaredOutput } from './declaredOutput'

// RuntimeBuildIdentity and workerLifecycle's public receipts (never connection tokens).
const buildFields = [
  'schemaVersion',
  'buildId',
  'appVersion',
  'channel',
  'protocolVersion',
  'ptyProtocolVersion',
  'launchContractVersion',
  'dataSchemaVersion',
]
export const lifecycleOutputs = {
  start: declaredOutput(['status'], { status: 'stopped' }),
  status: declaredOutput(
    [
      'pid',
      'status',
      'hostname',
      'port',
      'userDataPath',
      'startedBy',
      'appVersion',
      'createdAt',
      'reachable',
    ],
    { status: 'running', workers: [{ pid: 42 }] },
    { listKey: 'workers' },
  ),
  stop: declaredOutput(
    ['status', 'stopped', 'reason', 'pid', 'userDataPath', 'startedBy', 'forced'],
    { status: 'stopped' },
  ),
  inspect: declaredOutput(buildFields, { schemaVersion: 1 }),
  verify: declaredOutput(
    buildFields,
    {
      build: { schemaVersion: 1 },
      platform: 'darwin',
      arch: 'arm64',
      nodeAbi: '127',
      engine: 'node',
    },
    { itemKey: 'build' },
  ),
  prepare: declaredOutput(['status'], { status: 'prepared' }),
}
