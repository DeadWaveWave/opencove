import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'

function OverlappingDialogs({
  parentOpen,
  childOpen,
  initiallyInert = false,
}: {
  parentOpen: boolean
  childOpen: boolean
  initiallyInert?: boolean
}) {
  return (
    <>
      <main className="workspace-main" data-testid="canvas" inert={initiallyInert} />
      <header className="app-header" data-testid="header" />
      <Dialog
        open={parentOpen}
        aria-label="Sidebar"
        inertRootSelector=".workspace-main, .app-header"
        returnFocus={false}
        onDismiss={() => undefined}
      >
        <button>Project</button>
      </Dialog>
      <Dialog
        open={childOpen}
        aria-label="Project actions"
        inertRootSelector=".workspace-main, .app-header"
        returnFocus={false}
        onDismiss={() => undefined}
      >
        <button>Edit project</button>
      </Dialog>
    </>
  )
}

function expectRootsInert(inert: boolean) {
  for (const testId of ['canvas', 'header']) {
    expect(screen.getByTestId(testId).hasAttribute('inert')).toBe(inert)
  }
}

describe('Dialog shared inert roots', () => {
  it.each(['parent-first', 'child-first', 'together'] as const)(
    'restores roots only after every dialog releases them: %s',
    closeOrder => {
      const view = render(<OverlappingDialogs parentOpen childOpen={false} />)
      view.rerender(<OverlappingDialogs parentOpen childOpen />)
      expectRootsInert(true)

      if (closeOrder !== 'together') {
        view.rerender(
          <OverlappingDialogs
            parentOpen={closeOrder === 'child-first'}
            childOpen={closeOrder === 'parent-first'}
          />,
        )
        expectRootsInert(true)
      }

      view.rerender(<OverlappingDialogs parentOpen={false} childOpen={false} />)
      expectRootsInert(false)
    },
  )

  it('preserves an originally inert root through StrictMode setup and teardown', () => {
    const view = render(
      <React.StrictMode>
        <OverlappingDialogs parentOpen childOpen initiallyInert />
      </React.StrictMode>,
    )
    expectRootsInert(true)
    view.rerender(
      <React.StrictMode>
        <OverlappingDialogs parentOpen={false} childOpen={false} initiallyInert />
      </React.StrictMode>,
    )
    expect(screen.getByTestId('canvas').hasAttribute('inert')).toBe(true)
    expect(screen.getByTestId('header').hasAttribute('inert')).toBe(false)
  })
})
