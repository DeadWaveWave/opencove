import { describe, expect, it } from 'vitest'
import {
  classifyLeaseFsError,
  type LeaseFsErrorClass,
  type LeaseOperation,
} from '../../../src/contexts/settings/infrastructure/homeWorker/homeWorkerConfigLeaseErrors'

type Row = [code: string, win32: LeaseFsErrorClass, posix: LeaseFsErrorClass]

// The policy table of the Spec's section 2, one operation at a time: [code, win32, linux].
const TABLE: Record<LeaseOperation, Row[]> = {
  claim: [
    ['EEXIST', 'held', 'held'],
    ['ENOTEMPTY', 'held', 'held'],
    ['ENOTDIR', 'held', 'held'],
    ['EISDIR', 'held', 'held'],
    ['EPERM', 'ambiguous', 'fatal'],
    ['EACCES', 'ambiguous', 'fatal'],
    ['EBUSY', 'ambiguous', 'fatal'],
    ['ENOENT', 'fatal', 'fatal'],
    ['EUNKNOWN', 'fatal', 'fatal'],
  ],
  reclaim: [
    ['EEXIST', 'fatal', 'fatal'],
    ['ENOTEMPTY', 'fatal', 'fatal'],
    ['ENOTDIR', 'fatal', 'fatal'],
    ['EISDIR', 'fatal', 'fatal'],
    ['EPERM', 'ambiguous', 'fatal'],
    ['EACCES', 'ambiguous', 'fatal'],
    ['EBUSY', 'ambiguous', 'fatal'],
    ['ENOENT', 'absent', 'absent'],
    ['EUNKNOWN', 'fatal', 'fatal'],
  ],
  restore: [
    ['EEXIST', 'fatal', 'fatal'],
    ['ENOTEMPTY', 'fatal', 'fatal'],
    ['ENOTDIR', 'fatal', 'fatal'],
    ['EISDIR', 'fatal', 'fatal'],
    ['EPERM', 'ambiguous', 'fatal'],
    ['EACCES', 'ambiguous', 'fatal'],
    ['EBUSY', 'ambiguous', 'fatal'],
    ['ENOENT', 'fatal', 'fatal'],
    ['EUNKNOWN', 'fatal', 'fatal'],
  ],
  release: [
    ['EEXIST', 'fatal', 'fatal'],
    ['ENOTEMPTY', 'fatal', 'fatal'],
    ['ENOTDIR', 'fatal', 'fatal'],
    ['EISDIR', 'fatal', 'fatal'],
    ['EPERM', 'ambiguous', 'fatal'],
    ['EACCES', 'ambiguous', 'fatal'],
    ['EBUSY', 'ambiguous', 'fatal'],
    ['ENOENT', 'absent', 'absent'],
    ['EUNKNOWN', 'fatal', 'fatal'],
  ],
}

describe('classifyLeaseFsError', () => {
  for (const operation of Object.keys(TABLE) as LeaseOperation[]) {
    it(`classifies every code for ${operation} on win32 and on linux`, () => {
      for (const [code, win32, posix] of TABLE[operation]) {
        expect(classifyLeaseFsError(operation, code, 'win32'), `${operation} ${code} win32`).toBe(
          win32,
        )
        expect(classifyLeaseFsError(operation, code, 'linux'), `${operation} ${code} linux`).toBe(
          posix,
        )
        // macOS follows the POSIX column.
        expect(classifyLeaseFsError(operation, code, 'darwin'), `${operation} ${code} darwin`).toBe(
          posix,
        )
      }
    })

    it(`treats a missing code as fatal for ${operation}`, () => {
      expect(classifyLeaseFsError(operation, null, 'win32')).toBe('fatal')
      expect(classifyLeaseFsError(operation, null, 'linux')).toBe('fatal')
    })
  }
})
