import React from 'react'

export const TRANSIENT_LAYER_OWNER_ATTRIBUTE = 'data-cove-transient-layer-owner'

const TransientLayerOwnerContext = React.createContext<string | null>(null)

export const TransientLayerOwnerProvider = TransientLayerOwnerContext.Provider

export function useTransientLayerOwner(): string | null {
  return React.useContext(TransientLayerOwnerContext)
}

export function targetBelongsToTransientLayer(
  target: EventTarget | null,
  ownerId: string,
): boolean {
  let element = target instanceof Element ? target : null

  while (element) {
    if (element.getAttribute(TRANSIENT_LAYER_OWNER_ATTRIBUTE) === ownerId) {
      return true
    }
    element = element.parentElement
  }

  return false
}
