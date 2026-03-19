import React from 'react'
import type { ResizeEdges } from '../../utils/nodeFrameResize'

const HANDLE_CONFIGS: Array<{
  key: string
  suffix: string
  edges: ResizeEdges
}> = [
  { key: 'left', suffix: 'left', edges: { left: true } },
  { key: 'right', suffix: 'right', edges: { right: true } },
  { key: 'bottom', suffix: 'bottom', edges: { bottom: true } },
  { key: 'top-left', suffix: 'top-left', edges: { top: true, left: true } },
  { key: 'top-right', suffix: 'top-right', edges: { top: true, right: true } },
  { key: 'bottom-left', suffix: 'bottom-left', edges: { bottom: true, left: true } },
  { key: 'bottom-right', suffix: 'bottom-right', edges: { bottom: true, right: true } },
]

export function NodeResizeHandles({
  classNamePrefix,
  testIdPrefix,
  handleResizePointerDown,
}: {
  classNamePrefix: string
  testIdPrefix: string
  handleResizePointerDown: (edges: ResizeEdges) => (event: React.PointerEvent<HTMLElement>) => void
}): React.JSX.Element {
  return (
    <>
      {HANDLE_CONFIGS.map(handle => (
        <div
          key={handle.key}
          className={`${classNamePrefix}__resizer ${classNamePrefix}__resizer--${handle.suffix} nodrag`}
          data-testid={`${testIdPrefix}-${handle.suffix}`}
          onPointerDown={handleResizePointerDown(handle.edges)}
        />
      ))}
    </>
  )
}
