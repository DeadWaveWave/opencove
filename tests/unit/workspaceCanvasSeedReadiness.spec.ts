import { afterEach, describe, expect, it } from 'vitest'
import { isSeededWorkspaceNavigationReady } from '../e2e/workspace-canvas.seed-readiness'

describe('workspace seed navigation readiness', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('waits for every desktop project to appear in the rail', () => {
    document.body.innerHTML =
      '<div class="app-shell"><button class="workspace-item"></button></div>'
    expect(isSeededWorkspaceNavigationReady(2)).toBe(false)
    document
      .querySelector('.app-shell')!
      .append(document.querySelector('.workspace-item')!.cloneNode())
    expect(isSeededWorkspaceNavigationReady(2)).toBe(true)
  })

  it('accepts the mobile navigation entry while its drawer and project rail are closed', () => {
    document.body.innerHTML =
      '<div class="app-shell app-shell--mobile-navigation"><button data-testid="primary-sidebar-open"></button></div>'
    expect(document.querySelectorAll('.workspace-item').length).toBe(0)
    expect(isSeededWorkspaceNavigationReady(2)).toBe(true)
  })

  it('does not mistake an incomplete or disabled mobile shell for a ready navigation', () => {
    document.body.innerHTML = '<div class="app-shell app-shell--mobile-navigation"></div>'
    expect(isSeededWorkspaceNavigationReady(1)).toBe(false)
    const trigger = document.createElement('button')
    trigger.dataset.testid = 'primary-sidebar-open'
    trigger.disabled = true
    document.querySelector('.app-shell')!.append(trigger)
    expect(isSeededWorkspaceNavigationReady(1)).toBe(false)
    trigger.disabled = false
    trigger.style.display = 'none'
    expect(isSeededWorkspaceNavigationReady(1)).toBe(false)
  })

  it('keeps waiting while the startup state is still present', () => {
    document.body.innerHTML =
      '<div class="app-shell app-shell--mobile-navigation"><button data-testid="primary-sidebar-open"></button></div><div class="app-startup-state"></div>'
    expect(isSeededWorkspaceNavigationReady(1)).toBe(false)
  })
})
