import React from 'react'

export function SettingsPanelNavButton({
  isActive,
  label,
  testId,
  onClick,
}: {
  isActive: boolean
  label: string
  testId?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`settings-panel__nav-button${isActive ? ' settings-panel__nav-button--active' : ''}`}
    >
      {label}
    </button>
  )
}
