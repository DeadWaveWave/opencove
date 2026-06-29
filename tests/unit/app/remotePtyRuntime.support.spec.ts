import { describe, expect, it } from 'vitest'
import {
  parseListTerminalProfilesResult,
  parsePresentationSnapshot,
} from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.support'

describe('remotePtyRuntime support', () => {
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
})
