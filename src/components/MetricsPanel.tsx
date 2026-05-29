// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Spinner,
} from '@patternfly/react-core'
import {
  Chart,
  ChartArea,
  ChartAxis,
  ChartGroup,
  ChartLegend,
  ChartLine,
  ChartThemeColor,
  createContainer,
} from '@patternfly/react-charts/victory'
import { queryRange, type MatrixEntry } from '../api/metrics'
import { useTimeRange } from '../hooks/useTimeRange'
import {
  computeHover,
  defaultSeriesName,
  formatTooltipLabel,
  formatXTick,
  formatYTick,
  prepareData,
  type HoverState,
} from './metricsPanelHelpers'

// Brush container for drag-to-zoom. createContainer requires two
// behaviors so we tack on 'voronoi'; without labels/labelComponent it
// is harmless. Tooltips are handled by a plain HTML overlay below,
// not by Victory — SVG-clipping fights aren't worth it.
const BrushVoronoiContainer = createContainer(
  'brush',
  'voronoi',
) as unknown as React.ComponentType<{
  brushDimension: 'x' | 'y'
  defaultBrushArea?: 'all' | 'none' | 'disable' | 'move'
  brushStyle?: React.CSSProperties
  onBrushDomainChangeEnd?: (domain: { x: [Date, Date]; y: [number, number] }) => void
}>

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; series: MatrixEntry[]; endSeconds: number }
  | { kind: 'error'; message: string }

// ThresholdBand shades a horizontal stripe of the plot area between Y
// values `from` and `to`. Used for attention zones on percent panels
// — e.g. yellow at 70-90% and red at 90-100%. Bands render behind the
// lines so values plot on top of the shading. The colors are passed in
// rather than fixed so a panel can reuse the band machinery for
// whatever semantic threshold makes sense.
export type ThresholdBand = {
  from: number
  to: number
  color: string
  opacity?: number
}

const DEFAULT_BAND_OPACITY = 0.12

// MetricsPanel renders a single PromQL time-series as a line chart.
// Polls every 15s by default; cancels on unmount; uses queryRange so
// the chart shows context, not just the last sample.
//
// `seriesLabel(metric)` extracts a human label from the Prometheus
// `metric` map — defaults to the `system_name` label set by the
// targets writer, so per-host queries Just Work without a custom
// renderer.
export default function MetricsPanel({
  title,
  promql,
  yLabel,
  yDomain,
  rangeSeconds = 300,
  stepSeconds = 15,
  refreshIntervalMs = 15_000,
  seriesLabel,
  thresholds,
}: {
  title: ReactNode
  promql: string
  yLabel?: string
  yDomain?: [number, number]
  rangeSeconds?: number
  stepSeconds?: number
  refreshIntervalMs?: number
  seriesLabel?: (metric: Record<string, string>) => string
  thresholds?: ThresholdBand[]
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const ctx = useTimeRange()
  const effectiveRangeSeconds = ctx?.windowSeconds ?? rangeSeconds
  const effectiveStepSeconds = ctx?.stepSeconds ?? stepSeconds
  const isZoom = ctx?.range.kind === 'zoom'
  const zoomStart = ctx?.range.kind === 'zoom' ? ctx.range.startSec : undefined
  const zoomEnd = ctx?.range.kind === 'zoom' ? ctx.range.endSec : undefined

  const fetchOnce = useCallback(async () => {
    const end = zoomEnd ?? Math.floor(Date.now() / 1000)
    const start = zoomStart ?? end - effectiveRangeSeconds
    try {
      const series = await queryRange(promql, start, end, effectiveStepSeconds)
      setState({ kind: 'ready', series, endSeconds: end })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [promql, effectiveRangeSeconds, effectiveStepSeconds, zoomStart, zoomEnd])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await fetchOnce()
      if (cancelled) return
      if (!isZoom) {
        timerRef.current = setTimeout(tick, refreshIntervalMs)
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fetchOnce, refreshIntervalMs, isZoom])

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        {state.kind === 'loading' && (
          <Bullseye>
            <Spinner size="md" />
          </Bullseye>
        )}
        {state.kind === 'error' && (
          <Alert variant="danger" title="Metric query failed" isInline>
            {state.message}
          </Alert>
        )}
        {state.kind === 'ready' && (
          <SeriesChart
            series={state.series}
            yLabel={yLabel}
            yDomain={yDomain}
            seriesLabel={seriesLabel}
            windowSeconds={effectiveRangeSeconds}
            endSeconds={state.endSeconds}
            onZoom={ctx?.setZoom}
            thresholds={thresholds}
          />
        )}
      </CardBody>
    </Card>
  )
}

function SeriesChart({
  series,
  yLabel,
  yDomain,
  seriesLabel,
  windowSeconds,
  endSeconds,
  onZoom,
  thresholds,
}: {
  series: MatrixEntry[]
  yLabel?: string
  yDomain?: [number, number]
  seriesLabel?: (metric: Record<string, string>) => string
  windowSeconds: number
  endSeconds: number
  onZoom?: (startSec: number, endSec: number) => void
  thresholds?: ThresholdBand[]
}) {
  const data = useMemo(() => prepareData(series), [series])
  const xDomain: [Date, Date] = [
    new Date((endSeconds - windowSeconds) * 1000),
    new Date(endSeconds * 1000),
  ]
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  if (data.length === 0) {
    return <p>No samples in the selected window.</p>
  }
  const yMax = Math.max(...data.flatMap((d) => d.points.map((p) => p.y)))
  const yMin = Math.min(...data.flatMap((d) => d.points.map((p) => p.y)))
  // Victory inlines `fill` on the rendered SVG <text> elements, which
  // overrides the .pf-v6-theme-dark class on <html>. Threading
  // PatternFly's text-color tokens through the style prop lets the
  // SVG pick up the dark-mode value automatically — SVG fill accepts
  // var() in modern browsers.
  const axisStyle = {
    axis: { stroke: 'var(--pf-t--global--border--color--default)' },
    tickLabels: { fill: 'var(--pf-t--global--text--color--subtle)' },
    grid: { stroke: 'var(--pf-t--global--border--color--default)', strokeOpacity: 0.3 },
    axisLabel: { fill: 'var(--pf-t--global--text--color--regular)' },
  }
  const handleBrush = (domain: { x: [Date, Date] }) => {
    if (!onZoom || !domain.x) return
    const [s, e] = domain.x
    const startSec = Math.floor(s.getTime() / 1000)
    const endSec = Math.floor(e.getTime() / 1000)
    if (endSec - startSec < 5) return
    onZoom(startSec, endSec)
  }

  const PAD_LEFT = 60
  const PAD_RIGHT = 30
  const HEIGHT = 260
  const seriesNames = data.map((s) => (seriesLabel ?? defaultSeriesName)(s.metric))
  const showLegend = seriesNames.filter((n) => n !== '').length > 1
  const PAD_BOTTOM = showLegend ? 80 : 40
  const legendData = showLegend
    ? seriesNames.map((name) => ({ name: name || '—' }))
    : undefined

  const onMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const next = computeHover(
      e,
      containerRef.current,
      data,
      xDomain,
      PAD_LEFT,
      PAD_RIGHT,
    )
    setHover(next)
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', height: HEIGHT }}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <Chart
        ariaTitle="Metrics chart"
        themeColor={ChartThemeColor.multi}
        height={HEIGHT}
        padding={{ top: 10, right: PAD_RIGHT, bottom: PAD_BOTTOM, left: PAD_LEFT }}
        domain={{ x: xDomain, y: yDomain ?? [Math.min(0, yMin), yMax || 1] }}
        scale={{ x: 'time' }}
        legendData={legendData}
        legendPosition="bottom"
        legendOrientation="horizontal"
        legendComponent={
          <ChartLegend
            style={{
              labels: { fill: 'var(--pf-t--global--text--color--regular)' },
            }}
          />
        }
        containerComponent={
          <BrushVoronoiContainer
            brushDimension="x"
            defaultBrushArea="none"
            brushStyle={{
              stroke: 'transparent',
              fill: 'var(--pf-t--global--color--brand--default)',
              fillOpacity: 0.15,
            }}
            onBrushDomainChangeEnd={handleBrush}
          />
        }
      >
        <ChartAxis
          fixLabelOverlap
          style={axisStyle}
          tickFormat={(t: Date | number) =>
            formatXTick(t instanceof Date ? t : new Date(t), windowSeconds)
          }
        />
        <ChartAxis
          dependentAxis
          label={yLabel}
          style={axisStyle}
          tickFormat={(v: number) => formatYTick(v)}
        />
        {thresholds?.map((t, i) => (
          <ChartArea
            key={`threshold-${i}`}
            data={[
              { x: xDomain[0], y: t.to, y0: t.from },
              { x: xDomain[1], y: t.to, y0: t.from },
            ]}
            style={{
              data: {
                fill: t.color,
                fillOpacity: t.opacity ?? DEFAULT_BAND_OPACITY,
                stroke: 'none',
              },
            }}
          />
        ))}
        <ChartGroup>
          {data.map((s) => (
            <ChartLine
              key={s.key}
              name={(seriesLabel ?? defaultSeriesName)(s.metric)}
              data={s.points}
            />
          ))}
        </ChartGroup>
      </Chart>
      {hover && <HoverTooltip hover={hover} />}
    </div>
  )
}

function HoverTooltip({ hover }: { hover: HoverState }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: hover.viewportX + 12,
        top: hover.viewportY - 12,
        transform: 'translateY(-100%)',
        pointerEvents: 'none',
        background: 'var(--pf-t--global--background--color--primary--default)',
        color: 'var(--pf-t--global--text--color--regular)',
        border: '1px solid var(--pf-t--global--border--color--default)',
        borderRadius: 4,
        padding: '4px 8px',
        fontSize: '0.85rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        whiteSpace: 'nowrap',
        zIndex: 1000,
      }}
    >
      {formatTooltipLabel(hover.point.x, hover.point.y, hover.seriesName)
        .split('\n')
        .map((line, i) => (
          <div key={i}>{line}</div>
        ))}
    </div>,
    document.body,
  )
}

