import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function WebsiteNodeNativePlaceholder({
  onOpenAsIframe,
}: {
  onOpenAsIframe: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="website-node__native-placeholder nodrag">
      <div className="website-node__native-placeholder-title">
        {t('websiteNode.nativeUnavailableTitle')}
      </div>
      <div className="website-node__native-placeholder-detail">
        {t('websiteNode.nativeUnavailableDetail')}
      </div>
      <button
        type="button"
        className="website-node__native-placeholder-action"
        onClick={event => {
          event.stopPropagation()
          onOpenAsIframe()
        }}
      >
        {t('websiteNode.openAsIframe')}
      </button>
    </div>
  )
}
