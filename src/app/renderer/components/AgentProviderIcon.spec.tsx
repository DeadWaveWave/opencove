import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings'
import { AgentProviderIcon } from './AgentProviderIcon'
import { AgentProviderMark } from './AgentProviderMark'

describe('agent provider icon', () => {
  it.each(AGENT_PROVIDERS)(
    'draws the %s mark in one colour, the colour of the text around it',
    provider => {
      const { container } = render(<AgentProviderIcon provider={provider} />)
      const icon = container.querySelector('.agent-provider-icon')!
      expect(icon).toHaveAttribute('data-agent-provider', provider)
      const mark = icon.querySelector('svg')!
      expect(mark).toHaveAttribute('fill', 'currentColor')
      // A brand bitmap or a fixed fill would keep the vendor's colours in a monochrome list.
      expect(icon.querySelector('img, image, [fill]:not([fill="currentColor"])')).toBeNull()
    },
  )

  it('draws the OpenCode mark as its frame with the lower block in a lighter tone', () => {
    const { container } = render(<AgentProviderMark provider="opencode" />)
    const [frame, block] = Array.from(container.querySelectorAll('path'))
    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(frame).toHaveAttribute('fill-rule', 'evenodd')
    expect(frame).not.toHaveAttribute('fill-opacity')
    expect(block).toHaveAttribute('d', 'M18 24H6V12H18V24Z')
    expect(block).toHaveAttribute('fill-opacity', '0.4')
  })
})
