import { describe, expectTypeOf, expect, it } from 'vitest'
import { useAppStore, type AppStoreState } from './useAppStore'

// Workspace content is written through the document command module and the named store actions.
// A generic setter would let any caller replace the whole list again.
//
// This file lives under `src/` on purpose: `pnpm check` compiles spec files under `src/` and none
// under `tests/`, so the type assertion below fails the typecheck if the setter comes back.
describe('app store workspace writes', () => {
  it('offers no generic workspace setter, in the type or at runtime', () => {
    expectTypeOf<AppStoreState>().not.toHaveProperty('setWorkspaces')
    expect(useAppStore.getState()).not.toHaveProperty('setWorkspaces')
  })
})
