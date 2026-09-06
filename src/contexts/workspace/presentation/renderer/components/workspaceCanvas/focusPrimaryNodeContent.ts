import type { WorkspaceNodeKind } from '../../types'

const SHORTCUT_TARGETS = [
  '.terminal-node__terminal .xterm-helper-textarea',
  '[data-testid="task-node-inline-requirement-input"]',
  '[data-testid="note-node-textarea"]',
  '[data-testid="document-node-editor-input"]',
  'textarea, input, [contenteditable="true"]',
] as const

const CREATION_TARGETS: Partial<Record<WorkspaceNodeKind, string>> = {
  note: '[data-testid="note-node-textarea"]',
  document: '[data-testid="document-node-editor-input"]',
  role: '[data-testid="role-node-input"]',
  website: '.website-node__address-input',
}

/** Focus the real content target. The caller owns intent; this never clicks, selects, or pans. */
export function focusPrimaryNodeContent(
  node: HTMLElement,
  creationKind?: WorkspaceNodeKind,
): boolean {
  if (!node.isConnected || node.closest('[inert]')) {
    return false
  }
  const frameKind = creationKind === 'task' || creationKind === 'image' ? creationKind : null
  const selector = creationKind ? CREATION_TARGETS[creationKind] : null
  const selectors = frameKind
    ? [`.${frameKind}-node`]
    : creationKind
      ? selector
        ? [selector]
        : []
      : SHORTCUT_TARGETS
  for (const targetSelector of selectors) {
    const target = node.querySelector(targetSelector)
    if (!(target instanceof HTMLElement) || target.matches(':disabled')) {
      continue
    }
    const style = getComputedStyle(target)
    if (style.display === 'none' || style.visibility === 'hidden') {
      continue
    }
    if (frameKind && !target.hasAttribute('tabindex')) {
      target.tabIndex = -1
    }
    target.focus({ preventScroll: true })
    if (
      node.ownerDocument.activeElement === target ||
      target.contains(node.ownerDocument.activeElement)
    ) {
      return true
    }
  }
  return false
}
