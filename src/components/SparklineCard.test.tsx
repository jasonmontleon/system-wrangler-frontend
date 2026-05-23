// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SparklineCard from './SparklineCard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SparklineCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the title and the formatted current value', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: {},
              values: [
                [1_716_000_000, '0.10'],
                [1_716_000_060, '0.25'],
                [1_716_000_120, '0.42'],
              ],
            },
          ],
        },
      }),
    )
    render(
      <SparklineCard
        title="Load (1m)"
        promql="node_load1"
        format={(v) => v.toFixed(2)}
        refreshIntervalMs={1_000_000}
      />,
    )
    expect(await screen.findByText('Load (1m)')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('0.42')).toBeInTheDocument()
    })
  })

  it('shows em-dash when there are no samples', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      }),
    )
    render(
      <SparklineCard
        title="CPU"
        promql="up"
        format={(v) => v.toFixed(0)}
        refreshIntervalMs={1_000_000}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  it('surfaces error state', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 503))
    render(
      <SparklineCard
        title="Memory"
        promql="up"
        format={(v) => v.toFixed(0)}
        refreshIntervalMs={1_000_000}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('!')).toBeInTheDocument()
    })
  })

  it('fires onClick when the card is clicked', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      }),
    )
    const onClick = vi.fn()
    render(
      <SparklineCard
        title="Load"
        promql="node_load1"
        format={(v) => v.toFixed(2)}
        onClick={onClick}
        refreshIntervalMs={1_000_000}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Load'))
    expect(onClick).toHaveBeenCalled()
  })
})
