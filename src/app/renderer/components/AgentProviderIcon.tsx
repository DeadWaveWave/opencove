import type { JSX } from 'react'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { LabelColor } from '@shared/types/labelColor'

interface AgentProviderIconProps {
  provider: AgentProvider
  labelColor?: LabelColor | null
  className?: string
}

export function AgentProviderIcon({
  provider,
  labelColor = null,
  className,
}: AgentProviderIconProps): JSX.Element {
  const accessibleLabel = AGENT_PROVIDER_LABEL[provider]

  return (
    <span
      className={className ? `agent-provider-icon ${className}` : 'agent-provider-icon'}
      data-agent-provider={provider}
      data-cove-label-color={labelColor ?? undefined}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <ProviderGlyph provider={provider} />
    </span>
  )
}

function ProviderGlyph({ provider }: { provider: AgentProvider }): JSX.Element {
  switch (provider) {
    case 'claude-code':
      return (
        <svg
          className="agent-provider-icon__svg"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <ellipse cx="12" cy="4.75" rx="1.95" ry="3.15" fill="currentColor" />
          <ellipse cx="12" cy="19.25" rx="1.95" ry="3.15" fill="currentColor" />
          <ellipse cx="4.75" cy="12" rx="3.15" ry="1.95" fill="currentColor" />
          <ellipse cx="19.25" cy="12" rx="3.15" ry="1.95" fill="currentColor" />
          <ellipse
            cx="6.85"
            cy="6.85"
            rx="1.85"
            ry="3"
            transform="rotate(-45 6.85 6.85)"
            fill="currentColor"
          />
          <ellipse
            cx="17.15"
            cy="6.85"
            rx="1.85"
            ry="3"
            transform="rotate(45 17.15 6.85)"
            fill="currentColor"
          />
          <ellipse
            cx="6.85"
            cy="17.15"
            rx="1.85"
            ry="3"
            transform="rotate(45 6.85 17.15)"
            fill="currentColor"
          />
          <ellipse
            cx="17.15"
            cy="17.15"
            rx="1.85"
            ry="3"
            transform="rotate(-45 17.15 17.15)"
            fill="currentColor"
          />
          <circle cx="12" cy="12" r="1.55" fill="currentColor" />
        </svg>
      )
    case 'opencode':
      return (
        <svg
          className="agent-provider-icon__svg"
          aria-hidden="true"
          viewBox="0 0 24 30"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M18 6H6V24H18V6ZM24 30H0V0H24V30Z" fill="currentColor" />
        </svg>
      )
    case 'gemini':
      return (
        <svg
          className="agent-provider-icon__svg"
          aria-hidden="true"
          viewBox="0 0 50 50"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M49.04 24.001L47.958 23.958H47.957C36.134 23.492 26.508 13.866 26.042 2.043L25.999 0.96C25.978 0.424 25.537 0 25 0S24.022 0.424 24.001 0.96L23.958 2.043C23.492 13.866 13.866 23.492 2.042 23.958L0.96 24.001C0.424 24.022 0 24.463 0 25C0 25.537 0.424 25.978 0.961 25.999L2.043 26.041C13.866 26.508 23.492 36.134 23.958 47.957L24.001 49.04C24.022 49.576 24.463 50 25 50S25.978 49.576 25.999 49.04L26.042 47.957C26.508 36.134 36.134 26.508 47.957 26.041L49.039 25.999C49.576 25.978 50 25.537 50 25C50 24.463 49.576 24.022 49.04 24.001Z" />
        </svg>
      )
    case 'codex':
    default:
      return (
        <svg
          className="agent-provider-icon__svg"
          aria-hidden="true"
          viewBox="0 0 22 22"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8.43799 8.06943V6.09387C8.43799 5.92749 8.50347 5.80267 8.65601 5.71959L12.8206 3.43211C13.3875 3.1202 14.0635 2.9747 14.7611 2.9747C17.3775 2.9747 19.0347 4.9087 19.0347 6.96734C19.0347 7.11288 19.0347 7.27926 19.0128 7.44564L14.6956 5.03335C14.434 4.88785 14.1723 4.88785 13.9107 5.03335L8.43799 8.06943ZM18.1624 15.7637V11.0431C18.1624 10.7519 18.0315 10.544 17.7699 10.3984L12.2972 7.36234L14.0851 6.3849C14.2377 6.30182 14.3686 6.30182 14.5212 6.3849L18.6858 8.67238C19.8851 9.3379 20.6917 10.7519 20.6917 12.1243C20.6917 13.7047 19.7106 15.1604 18.1624 15.7636V15.7637ZM7.15158 11.6047L5.36369 10.6066C5.21114 10.5235 5.14566 10.3986 5.14566 10.2323V5.65735C5.14566 3.43233 6.93355 1.7478 9.35381 1.7478C10.2697 1.7478 11.1199 2.039 11.8396 2.55886L7.54424 4.92959C7.28268 5.07508 7.15181 5.28303 7.15181 5.57427V11.6049L7.15158 11.6047ZM11 13.7258L8.43799 12.3533V9.44209L11 8.06965L13.5618 9.44209V12.3533L11 13.7258ZM12.6461 20.0476C11.7303 20.0476 10.8801 19.7564 10.1604 19.2366L14.4557 16.8658C14.7173 16.7203 14.8482 16.5124 14.8482 16.2211V10.1905L16.658 11.1886C16.8105 11.2717 16.876 11.3965 16.876 11.563V16.1379C16.876 18.3629 15.0662 20.0474 12.6461 20.0474V20.0476ZM7.47863 15.4103L3.314 13.1229C2.11471 12.4573 1.30808 11.0433 1.30808 9.67088C1.30808 8.06965 2.31106 6.6348 3.85903 6.03168V10.773C3.85903 11.0642 3.98995 11.2721 4.25151 11.4177L9.70253 14.4328L7.91464 15.4103C7.76209 15.4934 7.63117 15.4934 7.47863 15.4103ZM7.23892 18.8207C4.77508 18.8207 2.96533 17.0531 2.96533 14.8696C2.96533 14.7032 2.98719 14.5368 3.00886 14.3704L7.30418 16.7412C7.56574 16.8867 7.82752 16.8867 8.08909 16.7412L13.5618 13.726V15.7015C13.5618 15.8679 13.4964 15.9927 13.3438 16.0758L9.17918 18.3633C8.61225 18.6752 7.93631 18.8207 7.23869 18.8207H7.23892ZM12.6461 21.2952C15.2844 21.2952 17.4865 19.5069 17.9882 17.1362C20.4301 16.5331 22 14.3495 22 12.1245C22 10.6688 21.346 9.25482 20.1685 8.23581C20.2775 7.79908 20.343 7.36234 20.343 6.92582C20.343 3.95215 17.8137 1.72691 14.892 1.72691C14.3034 1.72691 13.7365 1.80999 13.1695 1.99726C12.1882 1.08223 10.8364 0.5 9.35381 0.5C6.71557 0.5 4.51352 2.28829 4.01185 4.65902C1.56987 5.26214 0 7.44564 0 9.67067C0 11.1264 0.654039 12.5404 1.83147 13.5594C1.72246 13.9961 1.65702 14.4328 1.65702 14.8694C1.65702 17.8431 4.1863 20.0683 7.108 20.0683C7.69661 20.0683 8.26354 19.9852 8.83046 19.7979C9.81155 20.713 11.1634 21.2952 12.6461 21.2952Z"
            fill="currentColor"
          />
        </svg>
      )
  }
}
