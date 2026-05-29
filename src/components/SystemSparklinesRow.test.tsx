// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemSparklinesRow from './SystemSparklinesRow'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SystemSparklinesRow', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders Load / Memory used / Disk IO on non-Windows hosts', async () => {
    render(<SystemSparklinesRow systemId="sys-1" />)
    expect(await screen.findByText('Load (1m)')).toBeInTheDocument()
    expect(screen.getByText('Memory used')).toBeInTheDocument()
    expect(screen.getByText('Disk IO')).toBeInTheDocument()
    expect(screen.queryByText('CPU busy')).not.toBeInTheDocument()
  })

  it('swaps Load for CPU busy on Windows hosts', async () => {
    render(<SystemSparklinesRow systemId="sys-win" isWindows />)
    expect(await screen.findByText('CPU busy')).toBeInTheDocument()
    expect(screen.getByText('Memory used')).toBeInTheDocument()
    expect(screen.getByText('Disk IO')).toBeInTheDocument()
    expect(screen.queryByText('Load (1m)')).not.toBeInTheDocument()
  })

  it('threads system_id into each query', async () => {
    render(<SystemSparklinesRow systemId="sys-XYZ" />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0])
      expect(url).toContain('sys-XYZ')
    }
  })

  it('formats each card`s current value via the format callback', async () => {
    // Return a non-empty matrix so SparklineCard takes its `ready`
    // branch and invokes the format callback. The values are picked
    // so each card prints a distinguishable string.
    // Each SparklineCard makes its own queryRange call; Response
    // bodies can only be consumed once, so we mint a fresh one per
    // call via a function-style stub.
    const body = {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { system_id: 'sys-1' },
            values: [
              [1_716_000_000, '0.42'],
              [1_716_000_060, '7.50'],
            ],
          },
        ],
      },
    }
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse(body)))
    render(<SystemSparklinesRow systemId="sys-1" />)
    expect(await screen.findByText('7.50')).toBeInTheDocument()
    // Memory used card formats to integer-percent → 7.5 → "8%".
    expect(screen.getByText('8%')).toBeInTheDocument()
  })

  it('uses CPU busy formatter on Windows hosts', async () => {
    const fm = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { system_id: 'sys-1' },
              values: [[1_716_000_000, '78.3']],
            },
          ],
        },
      }),
    )
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', fm)
    render(<SystemSparklinesRow systemId="sys-1" isWindows />)
    // CPU busy format is v.toFixed(0) + "%".
    expect(await screen.findByText('78%')).toBeInTheDocument()
  })
})
