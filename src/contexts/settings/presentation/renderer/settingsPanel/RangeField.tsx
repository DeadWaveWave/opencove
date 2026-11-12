import React from 'react'

/** A range input on the settings track; SettingRow names it through the input. */
export function RangeField({
  wrapperStyle,
  neutralMarker = false,
  valueLabel,
  ...inputProps
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  wrapperStyle?: React.CSSProperties
  /** Marks the neutral value on the track (`--settings-panel-range-neutral-ratio`). */
  neutralMarker?: boolean
  /** Shown after the track, e.g. "60%". */
  valueLabel?: string
}): React.JSX.Element {
  return (
    <div
      className={
        neutralMarker
          ? 'settings-panel__range settings-panel__range--neutral-marker'
          : 'settings-panel__range'
      }
      style={wrapperStyle}
    >
      <input {...inputProps} type="range" />
      {valueLabel === undefined ? null : (
        <span className="settings-panel__range-value">{valueLabel}</span>
      )}
    </div>
  )
}
