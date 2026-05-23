// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext } from 'react'

export type RangeMode =
  | { kind: 'preset'; seconds: number }
  | { kind: 'zoom'; startSec: number; endSec: number }

export type TimeRangeValue = {
  range: RangeMode
  setPreset: (seconds: number) => void
  setZoom: (startSec: number, endSec: number) => void
  reset: () => void
  windowSeconds: number
  endSeconds: number
  stepSeconds: number
}

const TARGET_POINTS = 400
const MIN_STEP_SECONDS = 15

// STEP_LADDER snaps the auto-computed step up to a human-readable
// boundary (15s/30s/1m/2m/4m/10m/30m/1h/2h/6h/12h/24h) so axis ticks
// land on round values. Picking ceil(seconds/400) raw would yield
// 216s, 1512s, 6480s etc. — technically correct, visually awful.
const STEP_LADDER = [15, 30, 60, 120, 240, 600, 1800, 3600, 7200, 21600, 43200, 86400]

// stepFor picks a Prometheus query step that keeps the result under
// ~400 sample points regardless of how wide the window is, with a
// 15-second floor that matches the exporter scrape interval. The
// table in research/chart-time-controls.md shows the values this
// produces for each preset.
export function stepFor(windowSeconds: number): number {
  const raw = Math.max(MIN_STEP_SECONDS, Math.ceil(windowSeconds / TARGET_POINTS))
  for (const s of STEP_LADDER) if (s >= raw) return s
  return STEP_LADDER[STEP_LADDER.length - 1]
}

export const PRESETS: ReadonlyArray<{ id: string; label: string; seconds: number }> = [
  { id: '1h', label: '1h', seconds: 3600 },
  { id: '6h', label: '6h', seconds: 6 * 3600 },
  { id: '24h', label: '24h', seconds: 24 * 3600 },
  { id: '7d', label: '7d', seconds: 7 * 24 * 3600 },
  { id: '30d', label: '30d', seconds: 30 * 24 * 3600 },
  { id: '1y', label: '1y', seconds: 365 * 24 * 3600 },
]

export const DEFAULT_PRESET_SECONDS = 3600

export const TimeRangeContext = createContext<TimeRangeValue | undefined>(undefined)

// useTimeRange returns the active time-range context. Returns undefined
// when no provider is mounted so consumers can fall back to their own
// defaults — keeps existing call sites and unit tests working without
// wrapping every render in a provider.
export function useTimeRange(): TimeRangeValue | undefined {
  return useContext(TimeRangeContext)
}
