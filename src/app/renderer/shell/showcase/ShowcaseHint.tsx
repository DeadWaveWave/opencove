import React, { useEffect, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useShowcaseMode } from './showcaseMode'

const HINT_MS = 2400

/** On entering showcase mode, says once how to leave it, then gets out of the recording. */
export function ShowcaseHint(): React.JSX.Element | null {
  const { t } = useTranslation()
  const showcase = useShowcaseMode()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!showcase) {
      setVisible(false)
      return undefined
    }
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), HINT_MS)
    return () => window.clearTimeout(timer)
  }, [showcase])
  if (!visible) {
    return null
  }
  return (
    <div className="showcase-hint" role="status" data-testid="showcase-hint">
      {t('controlCenter.showcaseExitHint')}
    </div>
  )
}
