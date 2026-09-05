// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createManagedSshOperationDiagnosticSink } from '../../../src/app/main/controlSurface/topology/managedSshOperationDiagnostics'
import { managedSshDiagnosticDetails } from '../../../src/app/main/controlSurface/topology/managedSshDiagnosticDetails'

describe('Managed SSH diagnostics', () => {
  it('writes only allowed correlated lifecycle fields to the bounded runtime log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-ssh-diagnostics-'))
    try {
      const sink = createManagedSshOperationDiagnosticSink(root)
      const event = {
        type: 'phase' as const,
        endpointId: 'managed-1',
        operationId: 'operation-1',
        revision: 2,
        kind: 'prepare' as const,
        phase: 'starting_runtime' as const,
        startedAt: '2026-09-04T12:00:00Z',
        updatedAt: '2026-09-04T12:00:01Z',
        elapsedMs: 1000,
        token: 'PRIVATE_SENTINEL',
        args: ['PRIVATE_SENTINEL'],
        path: '/private/PRIVATE_SENTINEL',
      }
      sink(event)
      const output = await readFile(join(root, 'logs', 'runtime-diagnostics.log'), 'utf8')
      expect(output).not.toContain('PRIVATE_SENTINEL')
      expect(JSON.parse(output)).toMatchObject({
        event: 'managed-ssh-operation-phase',
        details: {
          endpointId: 'managed-1',
          operationId: 'operation-1',
          phase: 'starting_runtime',
          revision: 2,
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('strips display signals, terminal controls, secrets and duplicate details and caps lines', () => {
    const result = managedSshDiagnosticDetails(
      [
        '[opencove-bootstrap-progress:v1] starting_runtime\r\n\u001b[31mfailed SECRET\u001b[0m\nfailed SECRET',
        'https://user:password@example.test/failed\nnext\nextra',
      ],
      'SECRET',
    )
    expect(result).toEqual(['failed [redacted]', 'https://[redacted]@example.test/failed', 'next'])
  })
})
