export const NODE_NEAR_FRAME_ERROR =
  '--near allows size-only frames (width and height); remove x and y.'

/** Presence matters: even null coordinates express a conflicting placement request. */
export function hasNodeFrameCoordinates(frame: unknown): boolean {
  return frame !== null && typeof frame === 'object' && ('x' in frame || 'y' in frame)
}
