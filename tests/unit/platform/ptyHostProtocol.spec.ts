import {
  PTY_HOST_MAX_GEOMETRY_DIMENSION,
  PTY_HOST_PROTOCOL_VERSION,
  isPtyHostMessage,
  isPtyHostReadyEnvelope,
  isPtyHostRequest,
} from '@platform/process/ptyHost/protocol'

const HOST_INSTANCE_ID = 'host-instance-1'

function createSpawnRequest(): Record<string, unknown> {
  return {
    type: 'spawn',
    hostInstanceId: HOST_INSTANCE_ID,
    requestId: 'request-1',
    launchId: 'launch-1',
    command: '/bin/zsh',
    args: ['-lc', 'echo OK'],
    cwd: '/',
    env: { PATH: '/usr/bin', OPTIONAL: undefined },
    cols: 80,
    rows: 24,
  }
}

function createForegroundMessage(): Record<string, unknown> {
  return {
    type: 'foreground',
    hostInstanceId: HOST_INSTANCE_ID,
    sessionId: 'session-1',
    observedAtMs: 1_000,
    source: 'process_scan',
    exitCode: null,
    availability: 'available',
    agent: 'codex',
    shellOnly: false,
  }
}

describe('PTY host private protocol validation', () => {
  it('uses the hardened protocol version', () => {
    expect(PTY_HOST_PROTOCOL_VERSION).toBe(6)
  })

  it('accepts every complete request shape for the current host instance', () => {
    const requests: Array<Record<string, unknown>> = [
      createSpawnRequest(),
      {
        type: 'write',
        hostInstanceId: HOST_INSTANCE_ID,
        sessionId: 'session-1',
        data: 'echo OK',
        encoding: 'utf8',
      },
      {
        type: 'resize',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-2',
        sessionId: 'session-1',
        cols: 120,
        rows: 40,
      },
      { type: 'foreground_probe', hostInstanceId: HOST_INSTANCE_ID, sessionId: 'session-1' },
      { type: 'kill', hostInstanceId: HOST_INSTANCE_ID, sessionId: 'session-1' },
      { type: 'shutdown', hostInstanceId: HOST_INSTANCE_ID },
      { type: 'crash', hostInstanceId: HOST_INSTANCE_ID },
    ]

    expect(requests.every(request => isPtyHostRequest(request, HOST_INSTANCE_ID))).toBe(true)
  })

  it.each([
    ['null', null],
    ['unknown discriminant', { ...createSpawnRequest(), type: 'unknown' }],
    ['unexpected field', { ...createSpawnRequest(), extra: true }],
    ['missing host identity', { ...createSpawnRequest(), hostInstanceId: undefined }],
    ['wrong host identity', { ...createSpawnRequest(), hostInstanceId: 'stale-host' }],
    ['empty request id', { ...createSpawnRequest(), requestId: ' ' }],
    ['empty launch id', { ...createSpawnRequest(), launchId: '' }],
    ['empty command', { ...createSpawnRequest(), command: ' ' }],
    ['non-string argument', { ...createSpawnRequest(), args: ['ok', 2] }],
    ['array environment', { ...createSpawnRequest(), env: [] }],
    ['non-string environment value', { ...createSpawnRequest(), env: { BAD: 2 } }],
    ['fractional columns', { ...createSpawnRequest(), cols: 80.5 }],
    ['zero rows', { ...createSpawnRequest(), rows: 0 }],
    ['oversized geometry', { ...createSpawnRequest(), cols: PTY_HOST_MAX_GEOMETRY_DIMENSION + 1 }],
  ])('rejects malformed spawn request: %s', (_label, request) => {
    expect(isPtyHostRequest(request, HOST_INSTANCE_ID)).toBe(false)
  })

  it.each([
    [
      'write encoding',
      {
        type: 'write',
        hostInstanceId: HOST_INSTANCE_ID,
        sessionId: 'session-1',
        data: 'x',
        encoding: 'base64',
      },
    ],
    [
      'resize geometry',
      {
        type: 'resize',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-1',
        sessionId: 'session-1',
        cols: Number.NaN,
        rows: 24,
      },
    ],
    [
      'foreground probe shape',
      {
        type: 'foreground_probe',
        hostInstanceId: HOST_INSTANCE_ID,
        sessionId: 'session-1',
        extra: true,
      },
    ],
    ['kill identity', { type: 'kill', hostInstanceId: HOST_INSTANCE_ID, sessionId: '' }],
    ['shutdown shape', { type: 'shutdown', hostInstanceId: HOST_INSTANCE_ID, sessionId: 's1' }],
  ])('rejects malformed request field: %s', (_label, request) => {
    expect(isPtyHostRequest(request, HOST_INSTANCE_ID)).toBe(false)
  })

  it('validates ready envelopes separately from the supported protocol version', () => {
    const supported = {
      type: 'ready',
      protocolVersion: PTY_HOST_PROTOCOL_VERSION,
      hostInstanceId: HOST_INSTANCE_ID,
    }
    const mismatched = { ...supported, protocolVersion: PTY_HOST_PROTOCOL_VERSION + 1 }

    expect(isPtyHostReadyEnvelope(supported)).toBe(true)
    expect(isPtyHostMessage(supported)).toBe(true)
    expect(isPtyHostReadyEnvelope(mismatched)).toBe(true)
    expect(isPtyHostMessage(mismatched)).toBe(false)
    expect(isPtyHostReadyEnvelope({ ...supported, hostInstanceId: '' })).toBe(false)
  })

  it('accepts complete response and event shapes', () => {
    const messages: Array<Record<string, unknown>> = [
      {
        type: 'response',
        requestType: 'spawn',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-1',
        ok: true,
        result: { sessionId: 'session-1' },
      },
      {
        type: 'response',
        requestType: 'resize',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-2',
        ok: true,
        result: {
          sessionId: 'session-1',
          resize: { status: 'applied_verified', cols: 120, rows: 40 },
        },
      },
      {
        type: 'response',
        requestType: 'resize',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-3',
        ok: false,
        error: { name: 'Error', message: 'failed' },
      },
      { type: 'data', hostInstanceId: HOST_INSTANCE_ID, sessionId: 'session-1', data: 'OK' },
      { type: 'exit', hostInstanceId: HOST_INSTANCE_ID, sessionId: 'session-1', exitCode: 0 },
      createForegroundMessage(),
      {
        ...createForegroundMessage(),
        source: 'windows_exit_code',
        exitCode: 7,
        availability: 'unavailable',
        agent: null,
        shellOnly: false,
      },
    ]

    expect(messages.every(isPtyHostMessage)).toBe(true)
  })

  it.each([
    [
      'spawn response result',
      {
        type: 'response',
        requestType: 'spawn',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-1',
        ok: true,
        result: { sessionId: 4 },
      },
    ],
    [
      'resize response shape',
      {
        type: 'response',
        requestType: 'resize',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-1',
        ok: true,
        result: { sessionId: 'session-1' },
      },
    ],
    [
      'response exclusivity',
      {
        type: 'response',
        requestType: 'spawn',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-1',
        ok: false,
        result: { sessionId: 'session-1' },
        error: { message: 'failed' },
      },
    ],
    [
      'verified resize geometry',
      {
        type: 'response',
        requestType: 'resize',
        hostInstanceId: HOST_INSTANCE_ID,
        requestId: 'request-1',
        ok: true,
        result: {
          sessionId: 'session-1',
          resize: { status: 'applied_verified', cols: 0, rows: 24 },
        },
      },
    ],
    [
      'foreground source contract',
      { ...createForegroundMessage(), source: 'windows_exit_code', exitCode: null },
    ],
    [
      'foreground availability contract',
      { ...createForegroundMessage(), availability: 'unavailable', agent: 'codex' },
    ],
  ])('rejects malformed host message: %s', (_label, message) => {
    expect(isPtyHostMessage(message)).toBe(false)
  })
})
