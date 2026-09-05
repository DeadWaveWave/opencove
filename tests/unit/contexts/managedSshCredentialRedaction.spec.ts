import { describe, expect, it } from 'vitest'
import { managedSshDiagnosticDetails } from '../../../src/app/main/controlSurface/topology/managedSshDiagnosticDetails'

describe('managed SSH generated credential diagnostics', () => {
  it('redacts a worker-generated token that differs from the requested token', () => {
    const details = managedSshDiagnosticDetails(
      [
        '{"pid":2235,"token":"unexpected-worker-credential","port":59893}',
        'Authorization: Bearer other-credential',
        'http://127.0.0.1:59893/?token=query-credential',
      ],
      'expected-credential',
    ).join('\n')
    for (const secret of ['unexpected-worker-credential', 'other-credential', 'query-credential']) {
      expect(details).not.toContain(secret)
    }
    expect(details).toContain('2235')
  })
})
