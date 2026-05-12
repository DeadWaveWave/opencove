import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'

export const WEBSITE_NODE_IFRAME_SANDBOX =
  'allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation'

function isGoogleSearchOrHomeUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return (
    (host === 'google.com' || host === 'www.google.com') &&
    (url.pathname === '/' || url.pathname === '/search' || url.pathname === '/webhp')
  )
}

export function resolveWebsiteIframeSourceUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (!isGoogleSearchOrHomeUrl(parsed)) {
      return rawUrl
    }

    parsed.hostname = 'www.google.com'
    if (parsed.pathname === '/') {
      parsed.pathname = '/webhp'
    }
    parsed.searchParams.set('igu', '1')
    return parsed.toString()
  } catch {
    return rawUrl
  }
}

export function WebsiteNodeIframe({
  url,
  displayTitle,
}: {
  url: string
  displayTitle: string
}): JSX.Element {
  const { t } = useTranslation()
  const src = useMemo(() => resolveWebsiteIframeSourceUrl(url), [url])
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setLoadFailed(false)
  }, [src])

  return (
    <>
      <iframe
        className="website-node__iframe"
        src={src}
        title={displayTitle}
        sandbox={WEBSITE_NODE_IFRAME_SANDBOX}
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => {
          setLoadFailed(true)
        }}
      />
      {loadFailed ? (
        <div className="website-node__native-placeholder nodrag" role="status">
          <div className="website-node__native-placeholder-title">
            {t('websiteNode.iframeUnavailableTitle')}
          </div>
          <div className="website-node__native-placeholder-detail">
            {t('websiteNode.iframeUnavailableDetail')}
          </div>
        </div>
      ) : null}
    </>
  )
}
