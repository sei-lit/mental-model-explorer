import { createContext, useContext } from 'react'

export type ZoomLevel = 'far' | 'mid' | 'near'

const FAR_BELOW = 0.6
const NEAR_ABOVE = 1.25
const HYSTERESIS = 0.06

/** The thresholds differ by direction, so a zoom level sitting near a boundary does not flicker. */
export function nextZoomLevel(previous: ZoomLevel, zoom: number): ZoomLevel {
  const farLimit = previous === 'far' ? FAR_BELOW + HYSTERESIS : FAR_BELOW - HYSTERESIS
  const nearLimit = previous === 'near' ? NEAR_ABOVE - HYSTERESIS : NEAR_ABOVE + HYSTERESIS
  if (zoom < farLimit) return 'far'
  if (zoom > nearLimit) return 'near'
  return 'mid'
}

export const ZoomLevelContext = createContext<ZoomLevel>('mid')

export function useZoomLevel(): ZoomLevel {
  return useContext(ZoomLevelContext)
}
