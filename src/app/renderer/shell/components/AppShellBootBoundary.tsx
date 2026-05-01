import React from 'react'
import { AppStartupLoadingState } from './AppStartupLoadingState'

export function AppShellBootBoundary({
  isBootReady,
  children,
}: {
  isBootReady: boolean
  children: React.ReactNode
}): React.JSX.Element {
  if (!isBootReady) {
    return <AppStartupLoadingState />
  }

  return <>{children}</>
}
