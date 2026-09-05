import { describe, expect, it } from 'vitest'
import {
  createManagedSshBootstrapProgressParser,
  MANAGED_SSH_BOOTSTRAP_PHASES,
  MANAGED_SSH_BOOTSTRAP_PROGRESS_PREFIX,
} from '../../../src/app/main/controlSurface/topology/managedSshBootstrapProgress'
import {
  buildPosixBootstrapScript,
  buildWindowsBootstrapScript,
} from '../../../src/app/main/controlSurface/topology/managedSshRuntimeSupport'

const marker = (phase: string) => `${MANAGED_SSH_BOOTSTRAP_PROGRESS_PREFIX} ${phase}`

describe('Managed SSH bootstrap display markers', () => {
  it('parses exact markers across every split point including CRLF and final unterminated lines', () => {
    const output = `noise\n${marker('checking_remote_runtime')}\r\n${marker('starting_runtime')}`
    for (let split = 0; split <= output.length; split += 1) {
      const phases: string[] = []
      const parser = createManagedSshBootstrapProgressParser(phase => phases.push(phase))
      parser.push(output.slice(0, split))
      parser.push(output.slice(split))
      parser.finish()
      parser.finish()
      expect(phases).toEqual(['checking_remote_runtime', 'starting_runtime'])
    }
  })

  it('ignores non-exact, unknown and overlong lines without interpreting their suffixes', () => {
    const phases: string[] = []
    const parser = createManagedSshBootstrapProgressParser(phase => phases.push(phase))
    parser.push(`${marker('unknown')}\n ${marker('starting_runtime')}\n`)
    parser.push(`${marker('starting_runtime')} extra\n`)
    parser.push('[opencove-bootstrap-progress:v2] starting_runtime\n')
    parser.push('x'.repeat(1_000_000))
    parser.push(`${marker('starting_runtime')}\n${marker('waiting_for_runtime')}\n`)
    parser.finish()
    expect(phases).toEqual(['waiting_for_runtime'])
  })

  it('generates identical static display phases without interpolating secrets', () => {
    const access = {
      endpointId: 'progress-test',
      displayName: 'Test',
      token: 'TOKEN_SENTINEL',
      ssh: {
        host: 'HOST_SENTINEL',
        port: 22,
        username: 'USER_SENTINEL',
        remotePort: 43254,
        remotePlatform: 'auto' as const,
      },
    }
    for (const script of [
      buildPosixBootstrapScript(access, {
        installerUrl: 'https://URL_SENTINEL.test',
        reinstallRuntime: true,
      }),
      buildWindowsBootstrapScript(access, {
        installerUrl: 'https://URL_SENTINEL.test',
        reinstallRuntime: true,
      }),
    ]) {
      const markerLines = script
        .split('\n')
        .filter(line => line.includes(MANAGED_SSH_BOOTSTRAP_PROGRESS_PREFIX))
      expect(markerLines).toHaveLength(MANAGED_SSH_BOOTSTRAP_PHASES.length)
      expect(markerLines.join('\n')).not.toContain('SENTINEL')
      for (const phase of MANAGED_SSH_BOOTSTRAP_PHASES) {
        expect(markerLines.join('\n')).toContain(marker(phase))
      }
    }
  })
})
