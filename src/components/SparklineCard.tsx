// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { Card, CardBody } from '@patternfly/react-core'
import {
  Chart,
  ChartLine,
  ChartThemeColor,
} from '@patternfly/react-charts/victory'
import { queryRange } from '../api/metrics'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; points: Array<{ x: Date; y: number }>; current: number }

// SparklineCard is the glance-view companion to MetricsPanel: small
// title, a big current-value badge, and a chrome-less line chart
// underneath. No axes, no tooltip, no zoom — the badge carries the
// number; the line carries the shape. Polls every 30 seconds; uses a
// rolling 1h window regardless of the surrounding TimeRangeContext.
export default function SparklineCard({
  title,
  promql,
  format,
  yDomain,
  onClick,
  refreshIntervalMs = 30_000,
  rangeSeconds = 3600,
  stepSeconds = 60,
}: {
  title: string
  promql: string
  format: (v: number) => string
  yDomain?: [number, number]
  onClick?: () => void
  refreshIntervalMs?: number
  rangeSeconds?: number
  stepSeconds?: number
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const end = Math.floor(Date.now() / 1000)
      const start = end - rangeSeconds
      try {
        const series = await queryRange(promql, start, end, stepSeconds)
        if (cancelled) return
        const points = series
          .flatMap((s) => s.values)
          .map(([t, v]) => ({ x: new Date(t * 1000), y: parseFloat(v) }))
          .filter((p) => Number.isFinite(p.y))
        if (points.length === 0) {
          setState({ kind: 'empty' })
        } else {
          setState({
            kind: 'ready',
            points,
            current: points[points.length - 1].y,
          })
        }
      } catch (err) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
      if (!cancelled) {
        timer = setTimeout(tick, refreshIntervalMs)
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [promql, rangeSeconds, stepSeconds, refreshIntervalMs])

  const badge =
    state.kind === 'ready'
      ? format(state.current)
      : state.kind === 'empty'
        ? '—'
        : state.kind === 'error'
          ? '!'
          : '…'

  return (
    <Card
      isClickable={!!onClick}
      isCompact
      onClick={onClick ? () => onClick() : undefined}
      aria-label={title}
    >
      <CardBody style={{ padding: '0.75rem 1rem' }}>
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--pf-t--global--text--color--subtle)',
            marginBottom: '0.25rem',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            lineHeight: 1.1,
            color:
              state.kind === 'error'
                ? 'var(--pf-t--global--icon--color--status--danger--default)'
                : undefined,
          }}
        >
          {badge}
        </div>
        <div style={{ height: 48 }}>
          {state.kind === 'ready' && (
            <Chart
              ariaTitle={`${title} sparkline`}
              themeColor={ChartThemeColor.blue}
              height={48}
              padding={{ top: 4, right: 4, bottom: 4, left: 4 }}
              domain={yDomain ? { y: yDomain } : undefined}
              scale={{ x: 'time' }}
            >
              <ChartLine data={state.points} />
            </Chart>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
