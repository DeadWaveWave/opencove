import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  invokeRemoteControlSurfaceValue,
  parseListTerminalProfilesResult,
  parsePresentationSnapshot,
} from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.support'

describe('remotePtyRuntime support', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses remote terminal profiles and drops invalid entries', () => {
    expect(
      parseListTerminalProfilesResult({
        profiles: [
          { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' },
          { id: ' ', label: 'ignored', runtimeKind: 'windows' },
          { id: 'bash', label: 'Git Bash', runtimeKind: 'wsl' },
          { id: 'bad-kind', label: 'Broken', runtimeKind: 'unknown' },
        ],
        defaultProfileId: ' powershell ',
      }),
    ).toEqual({
      profiles: [
        { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' },
        { id: 'bash', label: 'Git Bash', runtimeKind: 'wsl' },
      ],
      defaultProfileId: 'powershell',
    })
  })

  it('rejects invalid remote terminal profile payloads', () => {
    expect(() => parseListTerminalProfilesResult(null)).toThrow(
      /Invalid pty\.listProfiles response payload/,
    )
  })

  it('preserves remote presentation snapshot geometry revision', () => {
    const snapshot = parsePresentationSnapshot('session-1', {
      appliedSeq: 4,
      presentationRevision: 5,
      cols: 100,
      rows: 32,
      geometryRevision: 9,
      bufferKind: 'normal',
      cursor: { x: 1, y: 2 },
      serializedScreen: 'ready',
    })

    expect(snapshot.geometryRevision).toBe(9)
  })

  it('preserves structured remote control-surface errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              __opencoveControlEnvelope: true,
              ok: false,
              error: {
                code: 'terminal.runtime_not_ready',
                details: {
                  workspaceId: 'workspace-ready',
                  phase: 'initializing',
                  epoch: 2,
                },
                debugMessage: 'Terminal runtime is initializing for workspace-ready.',
              },
            }),
            { status: 409 },
          ),
        ),
      ),
    )

    await expect(
      invokeRemoteControlSurfaceValue({
        endpointResolver: async () => ({ hostname: '127.0.0.1', port: 43210, token: 'test' }),
        kind: 'command',
        id: 'pty.spawn',
        payload: { cwd: '/workspace/root' },
        errorMessage: 'generic fallback',
      }),
    ).rejects.toMatchObject({
      name: 'OpenCoveAppError',
      code: 'terminal.runtime_not_ready',
      message: 'Terminal recovery is still in progress. Please wait a moment and try again.',
      details: {
        workspaceId: 'workspace-ready',
        phase: 'initializing',
        epoch: 2,
      },
      debugMessage: 'Terminal runtime is initializing for workspace-ready.',
    })
  })
})
