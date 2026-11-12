// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { openWritableSqliteDb } from '../../support/sqlite'

const sqlite = vi.hoisted(() => ({ native: vi.fn(), builtin: vi.fn(), require: vi.fn() }))
vi.mock('better-sqlite3', () => ({ default: sqlite.native }))
vi.mock('node:module', () => ({ createRequire: () => sqlite.require }))

beforeEach(() => {
  sqlite.native.mockReset()
  sqlite.builtin.mockReset()
  sqlite.require.mockReset()
})

it('opens better-sqlite3 without loading an unavailable experimental builtin', async () => {
  const db = { close: vi.fn() }
  sqlite.native.mockImplementation(function () {
    return db
  })
  sqlite.require.mockImplementation(() => {
    throw new Error('ERR_UNKNOWN_BUILTIN_MODULE')
  })
  expect(await openWritableSqliteDb(':memory:')).toBe(db)
  expect(sqlite.native).toHaveBeenCalledWith(':memory:')
  expect(sqlite.require).not.toHaveBeenCalled()
})

it('falls back to the builtin at runtime when the native binding is incompatible', async () => {
  const db = { close: vi.fn() }
  sqlite.native.mockImplementation(function () {
    throw new Error('native ABI mismatch')
  })
  sqlite.require.mockReturnValue({ DatabaseSync: sqlite.builtin })
  sqlite.builtin.mockImplementation(function () {
    return db
  })
  expect(await openWritableSqliteDb(':memory:')).toBe(db)
  expect(sqlite.require).toHaveBeenCalledWith('node:sqlite')
  expect(sqlite.builtin).toHaveBeenCalledWith(':memory:')
})

it('fails rather than silently skipping SQL assertions when neither engine can load', async () => {
  sqlite.native.mockImplementation(function () {
    throw new Error('native ABI mismatch')
  })
  sqlite.require.mockImplementation(() => {
    throw new Error('ERR_UNKNOWN_BUILTIN_MODULE')
  })
  await expect(openWritableSqliteDb(':memory:')).rejects.toThrow('ERR_UNKNOWN_BUILTIN_MODULE')
})
