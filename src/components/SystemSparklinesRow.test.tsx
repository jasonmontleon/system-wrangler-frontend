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
})
