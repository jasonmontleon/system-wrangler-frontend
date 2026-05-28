// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MetricsPanel from './MetricsPanel'
import { TimeRangeContext } from '../hooks/useTimeRange'
import {
  defaultSeriesName,
  formatTooltipLabel,
  formatXTick,
  formatYTick,
} from './metricsPanelHelpers'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('MetricsPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a chart when the query returns data', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { system_name: 'web-1' },
              values: [
                [1716_000_000, '0.5'],
                [1716_000_015, '0.7'],
                [1716_000_030, '0.8'],
              ],
            },
          ],
        },
      }),
    )
    render(
      <MetricsPanel
        title="Load average"
        promql="node_load1"
        refreshIntervalMs={1_000_000}
      />,
    )
    expect(await screen.findByText('Load average')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/No samples/i)).toBeNull()
    })
  })

  it('shows empty state when no samples', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      }),
    )
    render(
      <MetricsPanel
        title="Empty"
        promql="up"
        refreshIntervalMs={1_000_000}
      />,
    )
    expect(await screen.findByText(/No samples/i)).toBeInTheDocument()
  })

  it('surfaces an error when the query fails', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'upstream timeout' }, 504),
    )
    render(
      <MetricsPanel
        title="Broken"
        promql="up"
        refreshIntervalMs={1_000_000}
      />,
    )
    expect(
      await screen.findByText(/Metric query failed/i),
    ).toBeInTheDocument()
  })

  it('uses the pinned zoom range when context is in zoom mode', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { system_name: 'web-1' },
              values: [[1_716_000_100, '0.5']],
            },
          ],
        },
      }),
    )
    render(
      <TimeRangeContext.Provider
        value={{
          range: { kind: 'zoom', startSec: 1_716_000_000, endSec: 1_716_000_600 },
          setPreset: () => {},
          setZoom: () => {},
          reset: () => {},
          windowSeconds: 600,
          endSeconds: 1_716_000_600,
          stepSeconds: 15,
        }}
      >
        <MetricsPanel title="Zoomed" promql="up" />
      </TimeRangeContext.Provider>,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('start=1716000000')
    expect(url).toContain('end=1716000600')
    expect(url).toContain('step=15')
  })

  it('renders threshold bands as ChartArea paths with the configured fill colors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { system_name: 'web-1' },
              values: [
                [1_716_000_000, '50'],
                [1_716_000_015, '70'],
              ],
            },
          ],
        },
      }),
    )
    const { container } = render(
      <MetricsPanel
        title="CPU"
        promql="up"
        refreshIntervalMs={1_000_000}
        yDomain={[0, 100]}
        thresholds={[
          { from: 60, to: 85, color: '#F0AB00', opacity: 0.1 },
          { from: 85, to: 100, color: '#C9190B', opacity: 0.12 },
        ]}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByText(/No samples/i)).toBeNull()
    })
    // Victory inlines style.data via the path's style attribute, and
    // the browser CSS parser normalises hex colors to rgb(...). Look
    // for the rgb equivalent of each configured band color.
    const paths = Array.from(container.querySelectorAll('path'))
    const styles = paths
      .map((p) => p.getAttribute('style')?.toLowerCase() ?? '')
      .join(' ')
    expect(styles).toContain('rgb(240, 171, 0)') // #F0AB00 — warning
    expect(styles).toContain('rgb(201, 25, 11)') // #C9190B — danger
    expect(styles).toContain('fill-opacity: 0.1')
    expect(styles).toContain('fill-opacity: 0.12')
  })

  it('does not schedule a follow-up refresh in zoom mode', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      }),
    )
    render(
      <TimeRangeContext.Provider
        value={{
          range: { kind: 'zoom', startSec: 0, endSec: 600 },
          setPreset: () => {},
          setZoom: () => {},
          reset: () => {},
          windowSeconds: 600,
          endSeconds: 600,
          stepSeconds: 15,
        }}
      >
        <MetricsPanel title="Zoomed" promql="up" refreshIntervalMs={1_000} />
      </TimeRangeContext.Provider>,
    )
    await vi.runOnlyPendingTimersAsync()
    const callsBefore = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
    vi.useRealTimers()
  })
})

describe('formatXTick', () => {
  const d = new Date('2026-05-23T14:05:00Z')
  it('returns a clock string for sub-day windows', () => {
    const out = formatXTick(d, 3600)
    expect(out).toMatch(/\d{1,2}:\d{2}/)
    expect(out).not.toMatch(/May/)
  })
  it('returns a calendar string for multi-day windows', () => {
    const out = formatXTick(d, 7 * 24 * 3600)
    expect(out).toMatch(/May|23/)
  })
})

describe('defaultSeriesName', () => {
  it('prefers system_name over instance', () => {
    expect(
      defaultSeriesName({ system_name: 'web-1', instance: '10.0.0.5:9100' }),
    ).toBe('web-1')
  })
  it('falls back to instance when system_name absent', () => {
    expect(defaultSeriesName({ instance: '10.0.0.5:9100' })).toBe(
      '10.0.0.5:9100',
    )
  })
  it('returns empty string when no usable label', () => {
    expect(defaultSeriesName({ job: 'system-wrangler-internal' })).toBe('')
    expect(defaultSeriesName({})).toBe('')
  })
})

describe('formatTooltipLabel', () => {
  const d = new Date('2026-05-23T14:05:30Z')
  it('omits the series name when not given', () => {
    const out = formatTooltipLabel(d, 0.72)
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('0.72')
    expect(lines[1]).toMatch(/May/)
  })
  it('omits the series name when blank', () => {
    const out = formatTooltipLabel(d, 1, '   ')
    expect(out.split('\n')).toHaveLength(2)
  })
  it('prepends the series name when present', () => {
    const out = formatTooltipLabel(d, 7_500_000_000, 'web-1')
    const lines = out.split('\n')
    expect(lines[0]).toBe('web-1')
    expect(lines[1]).toBe('7.50G')
    expect(lines[2]).toMatch(/May/)
  })
})

describe('formatYTick', () => {
  it('uses SI suffixes for byte-scale values', () => {
    expect(formatYTick(7_500_000_000)).toBe('7.50G')
    expect(formatYTick(1_500_000)).toBe('1.50M')
    expect(formatYTick(2_500)).toBe('2.50k')
  })
  it('shows small values without a suffix', () => {
    expect(formatYTick(0.75)).toBe('0.75')
    expect(formatYTick(0)).toBe('0')
    expect(formatYTick(5)).toBe('5')
  })
  it('survives NaN / Infinity', () => {
    expect(formatYTick(NaN)).toBe('NaN')
    expect(formatYTick(Infinity)).toBe('Infinity')
  })
})
