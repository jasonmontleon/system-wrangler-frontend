// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESET_SECONDS,
  TimeRangeContext,
  useTimeRange,
} from '../hooks/useTimeRange'
import TimeRangePicker from './TimeRangePicker'
import { TimeRangeProvider } from './TimeRangeProvider'

function CurrentRange() {
  const ctx = useTimeRange()
  if (!ctx) return <span>no-ctx</span>
  return (
    <span data-testid="current">
      kind={ctx.range.kind} window={ctx.windowSeconds} step={ctx.stepSeconds}
    </span>
  )
}

describe('TimeRangePicker', () => {
  it('renders nothing when no provider is mounted', () => {
    const { container } = render(<TimeRangePicker />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows all five presets and marks the default selected', () => {
    render(
      <TimeRangeProvider>
        <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
      </TimeRangeProvider>,
    )
    for (const label of ['1h', '6h', '24h', '7d', '30d', '1y']) {
      expect(screen.getByRole('button', { name: `Show last ${label}` })).toBeInTheDocument()
    }
    const oneHour = screen.getByRole('button', { name: 'Show last 1h' })
    expect(oneHour).toHaveAttribute('aria-pressed', 'true')
  })

  it('switching presets updates window + step', () => {
    render(
      <TimeRangeProvider>
        <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
        <CurrentRange />
      </TimeRangeProvider>,
    )
    expect(screen.getByTestId('current').textContent).toContain('window=3600')
    expect(screen.getByTestId('current').textContent).toContain('step=15')

    fireEvent.click(screen.getByRole('button', { name: 'Show last 24h' }))
    expect(screen.getByTestId('current').textContent).toContain('window=86400')
    expect(screen.getByTestId('current').textContent).toContain('step=240')
  })

  it('reset button appears off-default and returns to default', () => {
    render(
      <TimeRangeProvider>
        <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
        <CurrentRange />
      </TimeRangeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show last 7d' }))
    const reset = screen.getByRole('button', { name: 'Reset' })
    fireEvent.click(reset)
    expect(screen.getByTestId('current').textContent).toContain('window=3600')
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })

  it('LIVE indicator is rendered while in preset mode', () => {
    render(
      <TimeRangeProvider>
        <TimeRangePicker />
      </TimeRangeProvider>,
    )
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.queryByText('PAUSED')).toBeNull()
  })

  it('PAUSED indicator + Reset are shown in zoom mode', () => {
    function ZoomTrigger() {
      const ctx = useTimeRange()!
      return (
        <button
          type="button"
          onClick={() => ctx.setZoom(1_000_000, 1_000_600)}
        >
          go zoom
        </button>
      )
    }
    render(
      <TimeRangeProvider>
        <TimeRangePicker defaultSeconds={3600} />
        <ZoomTrigger />
        <CurrentRange />
      </TimeRangeProvider>,
    )
    fireEvent.click(screen.getByText('go zoom'))
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
    expect(screen.queryByText('LIVE')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(screen.getByTestId('current').textContent).toContain('kind=zoom')
    expect(screen.getByTestId('current').textContent).toContain('window=600')
  })

  it('reset clears zoom and returns to default preset', () => {
    function ZoomTrigger() {
      const ctx = useTimeRange()!
      return (
        <button type="button" onClick={() => ctx.setZoom(0, 600)}>
          go zoom
        </button>
      )
    }
    render(
      <TimeRangeProvider>
        <TimeRangePicker defaultSeconds={3600} />
        <ZoomTrigger />
        <CurrentRange />
      </TimeRangeProvider>,
    )
    fireEvent.click(screen.getByText('go zoom'))
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByTestId('current').textContent).toContain('kind=preset')
    expect(screen.getByTestId('current').textContent).toContain('window=3600')
  })

  it('setZoom ignores degenerate ranges', () => {
    function ZoomTrigger() {
      const ctx = useTimeRange()!
      return (
        <button type="button" onClick={() => ctx.setZoom(500, 500)}>
          collapse
        </button>
      )
    }
    render(
      <TimeRangeProvider>
        <TimeRangePicker />
        <ZoomTrigger />
        <CurrentRange />
      </TimeRangeProvider>,
    )
    fireEvent.click(screen.getByText('collapse'))
    expect(screen.getByTestId('current').textContent).toContain('kind=preset')
  })

  it('respects a non-default initial preset', () => {
    render(
      <TimeRangeContext.Provider
        value={{
          range: { kind: 'preset', seconds: 6 * 3600 },
          setPreset: () => {},
          setZoom: () => {},
          reset: () => {},
          windowSeconds: 6 * 3600,
          endSeconds: 0,
          stepSeconds: 60,
        }}
      >
        <TimeRangePicker defaultSeconds={3600} />
      </TimeRangeContext.Provider>,
    )
    expect(
      screen.getByRole('button', { name: 'Show last 6h' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })
})
