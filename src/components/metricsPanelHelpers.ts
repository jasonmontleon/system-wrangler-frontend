// SPDX-License-Identifier: Apache-2.0

import type { MouseEvent as ReactMouseEvent } from 'react'
import type { MatrixEntry } from '../api/metrics'

// formatXTick renders the X-axis label for a sample timestamp. Victory
// otherwise stringifies Date objects to their numeric epoch ms, which
// is unreadable. For windows up to a day we show HH:MM; beyond that
// the date is more useful than the wall-clock time.
export function formatXTick(date: Date, windowSeconds: number): string {
  if (windowSeconds <= 24 * 3600) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

// defaultSeriesName picks a short, human-readable label out of a
// Prometheus metric label set. The full serialization (used as React
// key) includes __name__, instance, job, system_id, and any other
// labels and would stretch the tooltip past the chart width — this
// function returns just the host name when present.
export function defaultSeriesName(metric: Record<string, string>): string {
  return metric.system_name ?? metric.instance ?? ''
}

// formatTooltipLabel composes the hover tooltip text shown by the
// voronoi container. Always shows the value (SI-formatted) and a full
// time stamp; prepends the series name only when more than one series
// is rendered, since for a single-host panel the name is redundant.
export function formatTooltipLabel(
  x: Date,
  y: number,
  seriesName?: string,
): string {
  const time = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(x)
  const value = formatYTick(y)
  if (seriesName && seriesName.trim() !== '') {
    return `${seriesName}\n${value}\n${time}`
  }
  return `${value}\n${time}`
}

export type Prepared = {
  key: string
  metric: Record<string, string>
  points: Array<{ x: Date; y: number }>
}

// prepareData turns wire-shape MatrixEntry samples into per-series
// Prepared objects with Date X's and number Y's, dropping non-finite
// samples and any series whose entire window is non-finite.
export function prepareData(series: MatrixEntry[]): Prepared[] {
  const out: Prepared[] = []
  for (const entry of series) {
    const points = entry.values
      .map(([ts, raw]) => ({ x: new Date(ts * 1000), y: parseFloat(raw) }))
      .filter((p) => Number.isFinite(p.y))
    if (points.length === 0) continue
    out.push({
      key: serializeMetric(entry.metric),
      metric: entry.metric,
      points,
    })
  }
  return out
}

function serializeMetric(metric: Record<string, string>): string {
  const keys = Object.keys(metric).sort()
  return keys.map((k) => `${k}=${metric[k]}`).join(',')
}

export type HoverState = {
  cursorX: number
  cursorY: number
  viewportX: number
  viewportY: number
  point: { x: Date; y: number }
  seriesName: string
}

// computeHover finds the prepared sample nearest the cursor's X position
// inside the plot area. Returns null when the container ref is absent,
// the cursor is outside the plot area, or no samples are available.
export function computeHover(
  e: ReactMouseEvent<HTMLDivElement>,
  el: HTMLDivElement | null,
  data: Prepared[],
  xDomain: [Date, Date],
  padLeft: number,
  padRight: number,
): HoverState | null {
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const cursorX = e.clientX - rect.left
  const cursorY = e.clientY - rect.top
  const dataLeft = padLeft
  const dataRight = rect.width - padRight
  if (cursorX < dataLeft || cursorX > dataRight) return null
  const frac = (cursorX - dataLeft) / (dataRight - dataLeft)
  const startMs = xDomain[0].getTime()
  const endMs = xDomain[1].getTime()
  const targetMs = startMs + frac * (endMs - startMs)
  let best: { diff: number; point: Prepared['points'][number]; name: string } | null = null
  for (const s of data) {
    const name = s.metric.system_name ?? s.metric.instance ?? ''
    for (const p of s.points) {
      const diff = Math.abs(p.x.getTime() - targetMs)
      if (!best || diff < best.diff) {
        best = { diff, point: p, name }
      }
    }
  }
  if (!best) return null
  return {
    cursorX,
    cursorY,
    viewportX: e.clientX,
    viewportY: e.clientY,
    point: best.point,
    seriesName: best.name,
  }
}

// formatYTick renders large values with SI suffixes (1.2G, 480M) so
// byte-scale gauges don't sprawl across the axis. Small values pass
// through with up to 2 fraction digits.
export function formatYTick(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1e12) return (v / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'G'
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'k'
  if (abs >= 1 || v === 0) return v.toFixed(2).replace(/\.?0+$/, '')
  return v.toPrecision(2)
}
