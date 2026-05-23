// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_PRESET_SECONDS,
  TimeRangeContext,
  stepFor,
  type RangeMode,
  type TimeRangeValue,
} from '../hooks/useTimeRange'

// TimeRangeProvider supplies the active rolling window to every
// MetricsPanel underneath it. Preset mode advances `endSeconds` on a
// 1s tick so the rolling window stays live; zoom mode pins both the
// start and end so the chart freezes on the operator's selection. See
// research/chart-time-controls.md.
export function TimeRangeProvider({
  children,
  defaultSeconds = DEFAULT_PRESET_SECONDS,
}: {
  children: ReactNode
  defaultSeconds?: number
}) {
  const [range, setRange] = useState<RangeMode>({
    kind: 'preset',
    seconds: defaultSeconds,
  })
  const [liveEndSeconds, setLiveEndSeconds] = useState(() =>
    Math.floor(Date.now() / 1000),
  )

  useEffect(() => {
    if (range.kind !== 'preset') return
    const t = setInterval(() => {
      setLiveEndSeconds(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(t)
  }, [range.kind])

  const value = useMemo<TimeRangeValue>(() => {
    const windowSeconds =
      range.kind === 'preset' ? range.seconds : range.endSec - range.startSec
    const endSeconds = range.kind === 'preset' ? liveEndSeconds : range.endSec
    return {
      range,
      setPreset: (seconds: number) => setRange({ kind: 'preset', seconds }),
      setZoom: (startSec: number, endSec: number) => {
        if (endSec <= startSec) return
        setRange({ kind: 'zoom', startSec, endSec })
      },
      reset: () => setRange({ kind: 'preset', seconds: defaultSeconds }),
      windowSeconds,
      endSeconds,
      stepSeconds: stepFor(windowSeconds),
    }
  }, [range, liveEndSeconds, defaultSeconds])

  return (
    <TimeRangeContext.Provider value={value}>
      {children}
    </TimeRangeContext.Provider>
  )
}
