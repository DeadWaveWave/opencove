import { useAppStore } from '@app/renderer/shell/store/useAppStore'

export function openQuickMenuSettings(): void {
  const store = useAppStore.getState()
  store.setSettingsOpenPageId('quick-menu')
  store.setIsSettingsOpen(true)
}
